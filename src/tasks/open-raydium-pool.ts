import {
    ApiV3PoolInfoStandardItemCpmm,
    ApiV3Token,
    CpmmKeys,
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    Raydium,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import {
    importSwapperKeypairs,
    importKeypairFromFile,
    importMintKeypair,
    getTokenAccountInfo,
    KeypairKind,
} from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
import { formatDecimal, formatError, formatPublicKey } from "../helpers/format";
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
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    UNITS_PER_MINT,
    ZERO_BN,
} from "../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RaydiumCpmmPool,
    RAYDIUM_POOL_ERRORS,
    swapSolToMint,
} from "../modules/raydium";
import { STORAGE_RAYDIUM_LP_MINT, STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await fileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const snipers = importSwapperKeypairs(KeypairKind.Sniper);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const snipersToBuy = await findSnipersToBuy(snipers, mint);

        const lamportsToBuy = envVars.SNIPER_POOL_SHARE_PERCENTS.map(
            (poolSharePercent) =>
                new BN(
                    new Decimal(envVars.POOL_LIQUIDITY_SOL)
                        .mul(poolSharePercent)
                        .mul(LAMPORTS_PER_SOL)
                        .toFixed(0)
                )
        );

        const raydium = await createRaydium(connectionPool.current(), dev);

        const [sendCreatePoolTransaction, raydiumCpmmPool] = await createPool(raydium, dev, mint);
        const sendSwapSolToMintTransactions = await swapSolToMint(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            snipersToBuy,
            lamportsToBuy,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.VERY_HIGH,
            {
                skipPreflight: true,
                resendErrors: RAYDIUM_POOL_ERRORS,
            }
        );

        await Promise.all([sendCreatePoolTransaction, ...sendSwapSolToMintTransactions]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function findSnipersToBuy(snipers: Keypair[], mint: Keypair): Promise<(Keypair | null)[]> {
    const snipersToBuy: (Keypair | null)[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
            connectionPool,
            sniper,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        );

        if (mintTokenBalance && mintTokenBalance.gt(0)) {
            snipersToBuy[i] = null;
            logger.warn(
                "Sniper (%s) has sufficient balance on ATA (%s): %s %s",
                formatPublicKey(sniper.publicKey),
                formatPublicKey(mintTokenAccount),
                formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        snipersToBuy[i] = sniper;
    }

    return snipersToBuy;
}

async function createPool(
    raydium: Raydium,
    dev: Keypair,
    mint: Keypair
): Promise<[Promise<TransactionSignature | undefined>, RaydiumCpmmPool]> {
    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.debug("Raydium pool id (%s) loaded from storage", formatPublicKey(raydiumPoolId));

        const raydimLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydimLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }
        logger.debug("Raydium LP mint (%s) loaded from storage", formatPublicKey(raydimLpMint));

        const raydiumCpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(raydiumPoolId));
        return [Promise.resolve(undefined), raydiumCpmmPool];
    }

    const feeConfigs = await raydium.api.getCpmmConfigs();
    if (feeConfigs.length === 0) {
        throw new Error("CPMM fee configs not found");
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
            .mul(UNITS_PER_MINT)
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
        startTime: ZERO_BN,
        feeConfig,
        associatedOnly: true,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    const instructions = [...wrapSolInstructions, ...createPoolInstructions];
    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.DEFAULT,
        instructions,
        [dev]
    );

    const sendTransaction = sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to create pool id (${formatPublicKey(poolId)})`
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, poolId.toBase58());
    storage.set(STORAGE_RAYDIUM_LP_MINT, lpMint.toBase58());
    storage.save();
    logger.debug("Raydium pool id (%s) saved to storage", formatPublicKey(poolId));
    logger.debug(
        "Raydium %s-LP mint (%s) saved to storage",
        envVars.TOKEN_SYMBOL,
        formatPublicKey(lpMint)
    );

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
