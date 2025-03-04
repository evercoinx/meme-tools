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
    KeypairKind,
} from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
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
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    UNITS_PER_MINT,
    ZERO_BN,
    ZERO_DECIMAL,
} from "../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RAYDIUM_LP_MINT_DECIMALS,
    RaydiumCpmmPool,
    swapMintToSol,
} from "../modules/raydium";
import { STORAGE_RAYDIUM_LP_MINT, STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await fileExists(storage.cacheFilePath);

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

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const traders = importSwapperKeypairs(KeypairKind.Trader);

        const raydium = await createRaydium(connectionPool.current(), dev);
        const raydiumCpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(raydiumPoolId));

        const sniperUnitsToSell = await findUnitsToSell(snipers, mint, KeypairKind.Sniper);
        const traderUnitsToSell = await findUnitsToSell(traders, mint, KeypairKind.Trader);

        const sendRemoveRaydiumLiquidityPoolTransaction = await removeRaydiumPoolLiquidity(
            raydium,
            raydiumCpmmPool,
            dev,
            new PublicKey(raydiumLpMint)
        );
        await Promise.all([sendRemoveRaydiumLiquidityPoolTransaction]);

        const devUnitsToSell = await findUnitsToSell([dev], mint, KeypairKind.Dev);

        const sendSniperSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            snipers,
            sniperUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.VERY_HIGH,
            { skipPreflight: true }
        );
        const sendDevSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            raydiumCpmmPool,
            [dev],
            devUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
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
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.HIGH,
            { skipPreflight: true }
        );

        await Promise.all([
            ...sendSniperSwapMintToSolTransactions,
            ...sendDevSwapMintToSolTransactions,
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
    keypairKind: KeypairKind
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
                capitalize(keypairKind),
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
                capitalize(keypairKind),
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
                RAYDIUM_LP_MINT_DECIMALS
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
