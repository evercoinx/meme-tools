import { Percent, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import {
    getTokenAccountInfo,
    importKeypairFromFile,
    importMintKeypair,
    importSwapperKeypairs,
} from "../helpers/account";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import { capitalize, formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    SLIPPAGE_PERCENT,
    SwapperType,
    UNITS_PER_MINT,
    ZERO_BN,
    ZERO_DECIMAL,
} from "../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RaydiumCpmmPool,
    swapMintToSol,
} from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const dev = await importKeypairFromFile(envVars.KEYPAIR_FILE_PATH_DEV, "dev");
        const raydium = await createRaydium(connectionPool.current(), dev);
        const raydiumCpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(raydiumPoolId));

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_POOL_SHARE_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const sniperUnitsToSell = await findUnitsToSell(snipers, mint, SwapperType.Sniper);
        const traderUnitsToSell = await findUnitsToSell(traders, mint, SwapperType.Trader);

        const sendRemoveRaydiumLiquidityPoolTransaction = await removeRaydiumPoolLiquidity(
            raydium,
            raydiumCpmmPool,
            dev,
            new PublicKey(raydiumLpMint)
        );
        await Promise.all([sendRemoveRaydiumLiquidityPoolTransaction]);

        const devUnitsToSell = await findUnitsToSell([dev], mint, SwapperType.Dev);

        const sendDevSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            [dev],
            devUnitsToSell,
            SLIPPAGE_PERCENT,
            PriorityLevel.VERY_HIGH,
            { skipPreflight: true }
        );
        const sendSniperSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            snipers,
            sniperUnitsToSell,
            SLIPPAGE_PERCENT,
            PriorityLevel.VERY_HIGH,
            { skipPreflight: true }
        );
        const sendTraderSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            traders,
            traderUnitsToSell,
            SLIPPAGE_PERCENT,
            PriorityLevel.HIGH,
            { skipPreflight: true }
        );

        await Promise.all([
            ...sendDevSwapMintToSolTransactions,
            ...sendSniperSwapMintToSolTransactions,
            ...sendTraderSwapMintToSolTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function findUnitsToSell(
    accounts: Keypair[],
    mint: Keypair,
    swapperType: SwapperType
): Promise<(BN | null)[]> {
    const unitsToSell: (BN | null)[] = [];

    for (const [i, account] of accounts.entries()) {
        const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
            connectionPool,
            account,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        );

        if (!mintTokenBalance) {
            unitsToSell[i] = null;
            logger.warn(
                "%s (%s) has uninitialized %s ATA (%s)",
                capitalize(swapperType),
                formatPublicKey(account.publicKey),
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount)
            );
            continue;
        }
        if (mintTokenBalance.lte(ZERO_DECIMAL)) {
            unitsToSell[i] = null;
            logger.warn(
                "%s (%s) has insufficient balance on ATA (%s): %s %s",
                capitalize(swapperType),
                formatPublicKey(account.publicKey),
                formatPublicKey(mintTokenAccount),
                formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        unitsToSell[i] = new BN(mintTokenBalance.toFixed(0));
    }

    return unitsToSell;
}

async function removeRaydiumPoolLiquidity(
    raydium: Raydium,
    { poolInfo, poolKeys }: RaydiumCpmmPool,
    dev: Keypair,
    raydiumLpMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const [lpMintTokenAccount, lpMintTokenBalance] = await getTokenAccountInfo(
        connectionPool,
        dev,
        raydiumLpMint,
        TOKEN_PROGRAM_ID
    );

    if (!lpMintTokenBalance) {
        logger.warn(
            "Dev (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
        );
        return Promise.resolve(undefined);
    }
    if (lpMintTokenBalance.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Dev (%s) has insufficient balance on ATA (%s): %s LP-%s",
            formatPublicKey(dev.publicKey),
            formatPublicKey(lpMintTokenAccount),
            formatDecimal(
                lpMintTokenBalance.div(10 ** RAYDIUM_LP_MINT_DECIMALS),
                envVars.TOKEN_DECIMALS
            ),
            envVars.TOKEN_SYMBOL
        );
        return Promise.resolve(undefined);
    }

    const {
        transaction: { instructions },
    } = await raydium.cpmm.withdrawLiquidity<TxVersion.LEGACY>({
        poolInfo,
        poolKeys,
        lpAmount: new BN(lpMintTokenBalance.toFixed(0)),
        slippage: new Percent(ZERO_BN),
    });

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.HIGH,
        instructions,
        [dev]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to remove liquidity from pool id (${formatPublicKey(poolInfo.id)})`,
        { skipPreflight: true }
    );
}
