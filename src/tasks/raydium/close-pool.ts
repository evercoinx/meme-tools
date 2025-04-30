import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import {
    getTokenAccountInfo,
    importKeypairFromFile,
    importMintKeypair,
    importSwapperKeypairs,
    KeypairKind,
} from "../../helpers/account";
import { checkFileExists } from "../../helpers/filesystem";
import { capitalize, formatError, formatPublicKey } from "../../helpers/format";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    ZERO_DECIMAL,
} from "../../modules";
import { createRaydium, loadRaydiumCpmmPool, swapMintToSol } from "../../modules/raydium";
import { STORAGE_RAYDIUM_POOL_ID } from "../../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const poolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!poolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const whales = importSwapperKeypairs(KeypairKind.Whale);
        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const traders = importSwapperKeypairs(KeypairKind.Trader);

        const sniperUnitsToSell = await findUnitsToSell(snipers, mint, KeypairKind.Sniper);
        const whaleUnitsToSell = await findUnitsToSell(whales, mint, KeypairKind.Whale);
        const devUnitsToSell = await findUnitsToSell([dev], mint, KeypairKind.Dev);
        const traderUnitsToSell = await findUnitsToSell(traders, mint, KeypairKind.Trader);

        const raydium = await createRaydium(connectionPool.current(), dev);
        const cpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(poolId));

        const sendSniperSellMintTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            cpmmPool,
            snipers,
            sniperUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.HIGH,
            { skipPreflight: true }
        );
        const sendWhaleSellMintTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            cpmmPool,
            whales,
            whaleUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.HIGH,
            { skipPreflight: true }
        );
        const sendDevSellMintTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            cpmmPool,
            [dev],
            devUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.HIGH,
            { skipPreflight: true }
        );
        const sendTraderSellMintTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            raydium,
            cpmmPool,
            traders,
            traderUnitsToSell,
            SWAPPER_SLIPPAGE_PERCENT,
            PriorityLevel.DEFAULT,
            { skipPreflight: true }
        );

        await Promise.all([
            ...sendSniperSellMintTransactions,
            ...sendWhaleSellMintTransactions,
            ...sendDevSellMintTransactions,
            ...sendTraderSellMintTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
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
        const [mintTokenAccount, mintTokenBalance, mintTokenInitialized] =
            await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );

        if (!mintTokenInitialized) {
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
                "%s (%s) has zero balance on %s ATA (%s)",
                capitalize(keypairKind),
                formatPublicKey(account.publicKey),
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount)
            );
            continue;
        }

        unitsToSell[i] = new BN(mintTokenBalance.toFixed(0));
    }

    return unitsToSell;
}
