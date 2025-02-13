import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_TRADER_SECRET_KEYS,
    SwapperType,
    ZERO_DECIMAL,
} from "../modules";
import { loadRaydiumPoolInfo, swapMintToSol, swapSolToMint } from "../modules/raydium";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { getRandomFloat, shuffle } from "../helpers/random";

const SLIPPAGE = 0.05;

(async () => {
    try {
        await checkIfStorageExists();

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const traders = importSwapperKeypairs(
            envVars.TRADER_COUNT,
            SwapperType.Trader,
            STORAGE_TRADER_SECRET_KEYS
        );

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);
        const lamportsToBuy = await findLamportsToBuy(traders);

        const sendSwapSolToMintTransactions = await swapSolToMint(
            connection,
            poolInfo,
            traders,
            lamportsToBuy,
            SLIPPAGE,
            "Low"
        );
        await Promise.all(sendSwapSolToMintTransactions);

        const shuffledTraders = shuffle(traders) as Keypair[];
        const unitsToSell = await findUnitsToSell(shuffledTraders, mint);
        const sendSwapMintToSolTransactions = await swapMintToSol(
            connection,
            poolInfo,
            shuffledTraders,
            unitsToSell,
            SLIPPAGE,
            "Low"
        );
        await Promise.all(sendSwapMintToSolTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findLamportsToBuy(traders: Keypair[]): Promise<(BN | null)[]> {
    const lamportsToSwap: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const solBalance = new Decimal(await connection.getBalance(trader.publicKey, "confirmed"));
        const residualSolBalance = solBalance.sub(
            new Decimal(envVars.INITIAL_SWAPPER_BALANCE_SOL).mul(LAMPORTS_PER_SOL)
        );

        if (residualSolBalance.lte(0)) {
            lamportsToSwap[i] = null;
            logger.warn(
                "Trader #%d (%s) has insufficient SOL balance: %s",
                i,
                formatPublicKey(trader.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        lamportsToSwap[i] = new BN(residualSolBalance.toFixed(0));
    }

    return lamportsToSwap;
}

async function findUnitsToSell(traders: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSwap: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            trader.publicKey,
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
            unitsToSwap[i] = null;
            logger.warn(
                "Trader #%d (%s) has zero mint balance",
                i,
                formatPublicKey(trader.publicKey)
            );
            continue;
        }

        const sellPercent = new Decimal(getRandomFloat(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT));
        unitsToSwap[i] = new BN(sellPercent.mul(mintBalance).toFixed(0));
    }

    return unitsToSwap;
}
