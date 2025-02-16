import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importMintKeypair, importSwapperKeypairs } from "../helpers/account";
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

        const connection = connectionPool.next();
        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);

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
            {
                skipPreflight: true,
                commitment: "processed",
            }
        );
        await Promise.all(sendSniperSwapMintToSolTransactions);

        const sendTraderSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            poolInfo,
            traders,
            traderUnitsToSell,
            SLIPPAGE,
            "Default",
            {
                skipPreflight: true,
                commitment: "confirmed",
            }
        );
        await Promise.all(sendTraderSwapMintToSolTransactions);
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
        const connection = connectionPool.next();

        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            account.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let mintBalance = ZERO_DECIMAL;
        try {
            const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                mintTokenAccount,
                "confirmed"
            );
            mintBalance = new Decimal(mintTokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (mintBalance.lte(ZERO_DECIMAL)) {
            unitsToSell[i] = null;
            logger.warn(
                "%s (%s) has insufficient balance: %s %s",
                capitalize(swapperType),
                formatPublicKey(account.publicKey),
                formatDecimal(mintBalance.div(10 ** envVars.TOKEN_DECIMALS)),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        unitsToSell[i] = new BN(mintBalance.toFixed(0));
    }

    return unitsToSell;
}
