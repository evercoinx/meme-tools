import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatPublicKey } from "../helpers/format";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_SNIPER_SECRET_KEYS,
    STORAGE_TRADER_SECRET_KEYS,
    SwapperType,
    ZERO_BN,
} from "../modules";
import { loadRaydiumPoolInfo, swapMintToSol } from "../modules/raydium";

const SLIPPAGE = 0.3;

(async () => {
    try {
        await checkIfStorageExists();

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
            connectionPool.next(),
            new PublicKey(raydiumPoolId),
            mint
        );

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper,
            STORAGE_SNIPER_SECRET_KEYS
        );
        const traders = importSwapperKeypairs(
            envVars.TRADER_COUNT,
            SwapperType.Trader,
            STORAGE_TRADER_SECRET_KEYS
        );

        const sniperUnitsToSwap = await findUnitsToSwap(snipers, mint);
        const traderUnitsToSwap = await findUnitsToSwap(traders, mint);

        const sendSniperSwapMintToSolTransactions = await swapMintToSol(
            connectionPool,
            heliusClientPool,
            poolInfo,
            snipers,
            sniperUnitsToSwap,
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
            traderUnitsToSwap,
            SLIPPAGE,
            "Medium",
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

async function findUnitsToSwap(accounts: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSwap: (BN | null)[] = [];

    for (const [i, account] of accounts.entries()) {
        const connection = connectionPool.next();

        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            account.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        let mintBalance = ZERO_BN;

        try {
            const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                mintTokenAccount,
                "confirmed"
            );
            mintBalance = new BN(mintTokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (mintBalance.lte(ZERO_BN)) {
            unitsToSwap[i] = null;
            logger.warn(
                "Account #%d (%s) has zero mint balance",
                i,
                formatPublicKey(account.publicKey)
            );
            continue;
        }

        unitsToSwap[i] = mintBalance;
    }

    return unitsToSwap;
}
