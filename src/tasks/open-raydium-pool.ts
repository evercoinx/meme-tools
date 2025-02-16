import {
    ApiV3PoolInfoStandardItemCpmm,
    ApiV3Token,
    CpmmKeys,
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createBurnInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importSwapperKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    getWrapSolInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    SLIPPAGE,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    SwapperType,
} from "../modules";
import { CpmmPoolInfo, loadRaydium, loadRaydiumPoolInfo, swapSolToMint } from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const snipersToBuy = await findSnipersToBuy(snipers, mint);

        const lamportsToBuy = envVars.SNIPER_SHARE_POOL_PERCENTS.map(
            (sharePoolPercent) =>
                new BN(
                    new Decimal(envVars.POOL_LIQUIDITY_SOL)
                        .mul(sharePoolPercent)
                        .mul(LAMPORTS_PER_SOL)
                        .toFixed(0)
                )
        );

        const [sendCreatePoolTransaction, poolInfo] = await createPool(dev, mint);
        const sendSwapSolToMintTransactions = await swapSolToMint(
            connectionPool,
            heliusClientPool,
            poolInfo,
            snipersToBuy,
            lamportsToBuy,
            SLIPPAGE,
            "VeryHigh",
            { skipPreflight: true }
        );
        await Promise.all([sendCreatePoolTransaction]);
        await Promise.all(sendSwapSolToMintTransactions);

        const sendBurnLpMintTransaction = await burnLpMint(
            new PublicKey(poolInfo.poolInfo.lpMint.address),
            dev
        );
        await Promise.all([sendBurnLpMintTransaction]);
        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findSnipersToBuy(snipers: Keypair[], mint: Keypair): Promise<(Keypair | null)[]> {
    const snipersToBuy: (Keypair | null)[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const connection = connectionPool.next();

        const tokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            sniper.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let tokenBalance = new Decimal(0);
        try {
            const tokenAccountBalance = await connection.getTokenAccountBalance(
                tokenAccount,
                "confirmed"
            );
            tokenBalance = new Decimal(tokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (tokenBalance.gt(0)) {
            snipersToBuy[i] = null;
            logger.warn(
                "Sniper (%s) has sufficient balance: %s %s",
                formatPublicKey(sniper.publicKey),
                formatDecimal(tokenBalance.div(10 ** envVars.TOKEN_DECIMALS)),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        snipersToBuy[i] = sniper;
    }

    return snipersToBuy;
}

async function createPool(
    dev: Keypair,
    mint: Keypair
): Promise<[Promise<TransactionSignature | undefined>, CpmmPoolInfo]> {
    const connection = connectionPool.next();

    const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.debug("Raydium pool id loaded from storage", raydiumPoolId);

        const raydimLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydimLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }
        logger.debug("Raydium LP mint %s loaded from storage", raydimLpMint);

        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);
        return [Promise.resolve(undefined), poolInfo];
    }

    const raydium = await loadRaydium(connection, dev);

    const feeConfigs = await raydium.api.getCpmmConfigs();
    if (feeConfigs.length === 0) {
        throw new Error("No CPMM fee configs found");
    }
    feeConfigs.sort((a, b) => a.tradeFeeRate - b.tradeFeeRate);

    const feeConfig = feeConfigs[0];
    if (raydium.cluster === "devnet") {
        const id = getCpmmPdaAmmConfigId(
            DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
            feeConfig.index
        );
        feeConfig.id = id.publicKey.toBase58();
    }

    const programId =
        raydium.cluster === "devnet"
            ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
            : CREATE_CPMM_POOL_PROGRAM;

    const mintA = {
        address: NATIVE_MINT.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
        symbol: "WSOL",
        name: "Wrapped SOL",
        decimals: 9,
    } as ApiV3Token;
    const mintB = {
        address: mint.publicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        symbol: envVars.TOKEN_SYMBOL,
        name: envVars.TOKEN_SYMBOL,
        decimals: envVars.TOKEN_DECIMALS,
    } as ApiV3Token;

    const mintAAmount = new BN(
        new Decimal(envVars.POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL).toFixed(0)
    );
    const mintBAmount = new BN(
        new Decimal(envVars.TOKEN_SUPPLY)
            .mul(10 ** envVars.TOKEN_DECIMALS)
            .mul(envVars.POOL_SIZE_PERCENT)
            .toFixed(0)
    );

    const wrapSolInstructions = await getWrapSolInstructions(
        connection,
        dev,
        dev,
        new Decimal(envVars.POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL)
    );

    const {
        transaction: { instructions: createPoolInstructions },
        extInfo: {
            address: { poolId, lpMint, authority, vaultA, vaultB },
        },
    } = await raydium.cpmm.createPool<TxVersion.LEGACY>({
        programId,
        poolFeeAccount:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
                : CREATE_CPMM_POOL_FEE_ACC,
        mintA,
        mintB,
        mintAAmount,
        mintBAmount,
        startTime: new BN(0),
        feeConfig,
        associatedOnly: true,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    const heliusClient = heliusClientPool.next();

    const instructions = [...wrapSolInstructions, ...createPoolInstructions];
    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        heliusClient,
        "Default",
        instructions,
        dev
    );

    const sendTransaction = sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to create pool id (${poolId.toBase58()})`
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, poolId.toBase58());
    storage.set(STORAGE_RAYDIUM_LP_MINT, lpMint.toBase58());
    storage.save();
    logger.debug("Raydium pool id %s saved to storage", formatPublicKey(poolId));
    logger.debug("Raydium LP mint %s saved to storage", formatPublicKey(lpMint));

    const baseIn = NATIVE_MINT.toBase58() === mintA.address;

    return [
        sendTransaction,
        {
            poolInfo: {
                id: poolId.toBase58(),
                lpMint: {
                    address: lpMint.toBase58(),
                },
                mintA,
                mintB,
                programId: programId.toBase58(),
            } as ApiV3PoolInfoStandardItemCpmm,
            poolKeys: {
                authority: authority.toBase58(),
                vault: {
                    A: vaultA.toBase58(),
                    B: vaultB.toBase58(),
                },
                config: feeConfig,
            } as CpmmKeys,
            baseReserve: baseIn ? mintAAmount : mintBAmount,
            quoteReserve: baseIn ? mintBAmount : mintAAmount,
            tradeFee: new BN(feeConfig.tradeFeeRate),
        },
    ];
}

async function burnLpMint(
    lpMint: PublicKey,
    dev: Keypair
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.next();

    const lpMintAssociatedTokenAccount = getAssociatedTokenAddressSync(
        lpMint,
        dev.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    let lpMintBalance = new Decimal(0);

    try {
        const lpMintTokenAccountBalance = await connection.getTokenAccountBalance(
            lpMintAssociatedTokenAccount,
            "confirmed"
        );
        lpMintBalance = new Decimal(lpMintTokenAccountBalance.value.amount);
    } catch {
        logger.warn(
            "LP mint ATA (%s) not exists for dev (%s)",
            formatPublicKey(lpMintAssociatedTokenAccount),
            formatPublicKey(dev.publicKey)
        );
        return;
    }

    if (lpMintBalance.lte(0)) {
        logger.warn("Dev (%s) has 0 LP mint balance", formatPublicKey(dev.publicKey));
        return;
    }

    const instructions = [
        createBurnInstruction(
            lpMintAssociatedTokenAccount,
            lpMint,
            dev.publicKey,
            lpMintBalance.toNumber(),
            [],
            TOKEN_PROGRAM_ID
        ),
    ];

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        heliusClientPool.next(),
        "Default",
        instructions,
        dev
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to burn LP mint (${formatPublicKey(lpMint)}) for dev (${formatPublicKey(dev.publicKey)})`
    );
}
