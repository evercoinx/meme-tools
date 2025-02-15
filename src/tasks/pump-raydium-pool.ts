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
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { generateRandomFloat, generateRandomInteger, shuffle } from "../helpers/random";
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
import { loadRaydiumPoolInfo, swapMintToSol, swapSolToMint } from "../modules/raydium";

const TRADER_GROUP_SIZE = 1;

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

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

        for (let i = 0; i < traders.length; i += TRADER_GROUP_SIZE) {
            const traderGroup = traders.slice(i, i + TRADER_GROUP_SIZE);

            const lamportsToBuy = await findLamportsToBuy(traderGroup);
            const sendSwapSolToMintTransactions = await swapSolToMint(
                connectionPool,
                heliusClientPool,
                poolInfo,
                traderGroup,
                lamportsToBuy,
                SLIPPAGE,
                "Low"
            );
            if (sendSwapSolToMintTransactions.length === 0) {
                logger.warn("0 buys left");
                continue;
            }

            await Promise.all(sendSwapSolToMintTransactions);

            await new Promise((resolve) => {
                const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
                logger.info(
                    "%d buy(s) executed. Pausing: %d sec",
                    sendSwapSolToMintTransactions.length,
                    formatDecimal(delay / 1_000, 3)
                );
                setTimeout(resolve, delay);
            });

            const shuffledTraderGroup = shuffle(traderGroup) as Keypair[];
            const unitsToSell = await findUnitsToSell(shuffledTraderGroup, mint);
            const sendSwapMintToSolTransactions = await swapMintToSol(
                connectionPool,
                heliusClientPool,
                poolInfo,
                shuffledTraderGroup,
                unitsToSell,
                SLIPPAGE,
                "Low"
            );
            if (sendSwapMintToSolTransactions.length !== sendSwapSolToMintTransactions.length) {
                logger.warn(
                    "Buys and sells mistmatch: %d != %d",
                    sendSwapMintToSolTransactions.length,
                    sendSwapSolToMintTransactions.length
                );
                continue;
            }

            await Promise.all(sendSwapMintToSolTransactions);

            await new Promise((resolve) => {
                const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
                logger.info(
                    "%d sell(s) executed. Pausing: %d sec",
                    sendSwapMintToSolTransactions.length,
                    formatDecimal(delay / 1_000, 3)
                );
                setTimeout(resolve, delay);
            });
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findLamportsToBuy(traders: Keypair[]): Promise<(BN | null)[]> {
    const lamportsToSwap: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const connection = connectionPool.next();

        const solBalance = new Decimal(await connection.getBalance(trader.publicKey, "confirmed"));
        const residualSolBalance = solBalance.sub(
            new Decimal(envVars.INITIAL_SWAPPER_BALANCE_SOL).mul(LAMPORTS_PER_SOL)
        );

        if (residualSolBalance.lte(0)) {
            lamportsToSwap[i] = null;
            logger.warn(
                "Trader (%s) has insufficient SOL balance: %s",
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
        const connection = connectionPool.next();

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
            logger.warn("Trader (%s) has 0 mint balance", formatPublicKey(trader.publicKey));
            continue;
        }

        const sellPercent = new Decimal(
            generateRandomFloat(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT)
        );
        unitsToSwap[i] = new BN(sellPercent.mul(mintBalance).toFixed(0));
    }

    return unitsToSwap;
}
