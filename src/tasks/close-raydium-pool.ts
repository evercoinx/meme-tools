import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getTokenAccountInfo, importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { capitalize, formatDecimal, formatPublicKey } from "../helpers/format";
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
    ZERO_DECIMAL,
} from "../modules";
import { loadRaydiumPoolInfo, swapMintToSol } from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(
            connectionPool.current(),
            new PublicKey(raydiumPoolId),
            mint
        );

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const sniperUnitsToSell = await findUnitsToSell(snipers, mint, SwapperType.Sniper);
        const traderUnitsToSell = await findUnitsToSell(traders, mint, SwapperType.Trader);

        const sendSniperSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            poolInfo,
            snipers,
            sniperUnitsToSell,
            SLIPPAGE,
            "VeryHigh",
            { skipPreflight: true }
        );
        await Promise.all(sendSniperSwapMintToSolTransactions);

        const sendTraderSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            poolInfo,
            traders,
            traderUnitsToSell,
            SLIPPAGE,
            "High",
            { skipPreflight: true }
        );
        await Promise.all(sendTraderSwapMintToSolTransactions);
        process.exit(0);
    } catch (err) {
        logger.fatal(err);
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
                formatDecimal(mintTokenBalance.div(10 ** envVars.TOKEN_DECIMALS)),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        unitsToSell[i] = new BN(mintTokenBalance.toFixed(0));
    }

    return unitsToSell;
}
