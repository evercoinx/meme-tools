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
    createAssociatedTokenAccountInstruction,
    createBurnInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importSwapperKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
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
        const lamportsToSwap = envVars.SNIPER_SHARE_POOL_PERCENTS.map(
            (percent) =>
                new BN(
                    new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL)
                        .mul(percent)
                        .mul(LAMPORTS_PER_SOL)
                        .toFixed(0)
                )
        );
        const snipersToExecuteSwap = await findSnipersToExecuteSwap(snipers, mint);

        const [sendCreatePoolTransaction, poolInfo] = await createPool(dev, mint);
        const sendSwapSolToMintTransactions = await swapSolToMint(
            connectionPool,
            heliusClientPool,
            poolInfo,
            snipersToExecuteSwap,
            lamportsToSwap,
            SLIPPAGE,
            "VeryHigh",
            {
                skipPreflight: true,
                commitment: "confirmed",
            }
        );
        await Promise.all([sendCreatePoolTransaction]);
        await Promise.all(sendSwapSolToMintTransactions);

        const sendBurnLpMintTransaction = await burnLpMint(
            new PublicKey(poolInfo.poolInfo.lpMint.address),
            dev
        );
        await Promise.all([sendBurnLpMintTransaction]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findSnipersToExecuteSwap(
    snipers: Keypair[],
    mint: Keypair
): Promise<(Keypair | null)[]> {
    const snipersToExecuteSwap: (Keypair | null)[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const connection = connectionPool.next();

        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            sniper.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let mintBalance = new Decimal(0);
        try {
            const tokenAccountBalance = await connection.getTokenAccountBalance(
                mintTokenAccount,
                "confirmed"
            );
            mintBalance = new Decimal(tokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (mintBalance.gt(0)) {
            snipersToExecuteSwap[i] = null;
            logger.warn(
                "Sniper #$%d (%s) has non zero mint balance: %s",
                i,
                formatPublicKey(sniper.publicKey),
                formatDecimal(mintBalance.div(10 ** envVars.TOKEN_DECIMALS))
            );
            continue;
        }

        snipersToExecuteSwap[i] = sniper;
    }

    return snipersToExecuteSwap;
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
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL).toFixed(0)
    );
    const mintBAmount = new BN(
        new Decimal(envVars.TOKEN_SUPPLY)
            .mul(10 ** envVars.TOKEN_DECIMALS)
            .mul(envVars.INITIAL_POOL_SIZE_PERCENT)
            .toFixed(0)
    );

    const wrapSolInstructions = await getWrapSolInstructions(
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL),
        dev
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

async function getWrapSolInstructions(
    amount: Decimal,
    owner: Keypair
): Promise<TransactionInstruction[]> {
    const tokenAccount = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        owner.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const connection = connectionPool.next();
    const instructions: TransactionInstruction[] = [];
    let wsolBalance = new Decimal(0);

    try {
        const account = await getAccount(connection, tokenAccount, "confirmed", TOKEN_PROGRAM_ID);
        wsolBalance = new Decimal(account.amount.toString(10));
    } catch {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                owner.publicKey,
                tokenAccount,
                owner.publicKey,
                NATIVE_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    const lamports = amount.mul(LAMPORTS_PER_SOL);
    let residualLamports = new Decimal(0);
    if (wsolBalance.lt(lamports)) {
        residualLamports = lamports.sub(wsolBalance);
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: tokenAccount,
                lamports: residualLamports.toNumber(),
            }),
            createSyncNativeInstruction(tokenAccount, TOKEN_PROGRAM_ID)
        );
    }

    return instructions;
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
        logger.warn("Dev (%s) has zero LP mint balance", formatPublicKey(dev.publicKey));
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
