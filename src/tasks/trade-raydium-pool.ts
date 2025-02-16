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
import {
    CpmmPoolInfo,
    loadRaydiumPoolInfo,
    swapMintToSol,
    swapSolToMint,
} from "../modules/raydium";

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

        const traders = shuffle(importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader));

        const connection = connectionPool.next();
        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);

        for (let i = 0; i < traders.length; i += envVars.TRADER_GROUP_SIZE) {
            const traderGroup = traders.slice(i, i + envVars.TRADER_GROUP_SIZE);

            switch (envVars.POOL_TRADING_MODE) {
                case "volume": {
                    const buyTransactionCount = await pumpPool(poolInfo, traderGroup);
                    if (buyTransactionCount > 0) {
                        await dumpPool(poolInfo, shuffle(traderGroup), mint);
                    }
                    break;
                }
                case "pump": {
                    await pumpPool(poolInfo, traderGroup);
                    break;
                }
                case "dump": {
                    await dumpPool(poolInfo, traderGroup, mint);
                    break;
                }
                default: {
                    throw new Error(`Unknown trading mode: ${envVars.POOL_TRADING_MODE}`);
                }
            }

            logger.info("-".repeat(80));
        }

        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function pumpPool(poolInfo: CpmmPoolInfo, traderGroup: Keypair[]): Promise<number> {
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
        logger.warn("No buy transactions found. Skipping");
        return 0;
    }

    await Promise.all(sendSwapSolToMintTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "%d buy transaction(s) executed. Pausing: %d sec",
            sendSwapSolToMintTransactions.length,
            formatDecimal(delay / 1_000, 3)
        );
        setTimeout(resolve, delay);
    });

    return sendSwapSolToMintTransactions.length;
}

async function dumpPool(
    poolInfo: CpmmPoolInfo,
    traderGroup: Keypair[],
    mint: Keypair
): Promise<number> {
    const unitsToSell = await findUnitsToSell(traderGroup, mint);
    const sendSwapMintToSolTransactions = await swapMintToSol(
        connectionPool,
        heliusClientPool,
        poolInfo,
        traderGroup,
        unitsToSell,
        SLIPPAGE,
        "Low"
    );
    if (sendSwapMintToSolTransactions.length === 0) {
        logger.warn("No sell transactions found. Skipping");
        return 0;
    }

    await Promise.all(sendSwapMintToSolTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "%d sell transaction(s) executed. Pausing: %d sec",
            sendSwapMintToSolTransactions.length,
            formatDecimal(delay / 1_000, 3)
        );
        setTimeout(resolve, delay);
    });

    return sendSwapMintToSolTransactions.length;
}

async function findLamportsToBuy(traders: Keypair[]): Promise<(BN | null)[]> {
    const lamportsToSwap: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const connection = connectionPool.next();

        let currentSolBalance = ZERO_DECIMAL;
        try {
            currentSolBalance = new Decimal(
                await connection.getBalance(trader.publicKey, "confirmed")
            );
        } catch {
            logger.warn("Failed to get balance for trader (%s)", formatPublicKey(trader.publicKey));
            continue;
        }

        const buyAmount = new Decimal(generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL));
        const expectedSolBalance = new Decimal(envVars.TRADER_BALANCE_SOL)
            .add(buyAmount)
            .mul(LAMPORTS_PER_SOL);

        const residualSolBalance = currentSolBalance.sub(expectedSolBalance);
        if (residualSolBalance.lte(0)) {
            lamportsToSwap[i] = null;
            logger.warn(
                "Trader (%s) has insufficient balance: %s SOL. Expected: %s SOL",
                formatPublicKey(trader.publicKey),
                formatDecimal(currentSolBalance.div(LAMPORTS_PER_SOL)),
                formatDecimal(expectedSolBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        lamportsToSwap[i] = new BN(buyAmount.mul(LAMPORTS_PER_SOL).toFixed(0));
    }

    return lamportsToSwap;
}

async function findUnitsToSell(traders: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSell: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const connection = connectionPool.next();

        const tokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            trader.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let tokenBalance = ZERO_DECIMAL;
        try {
            const tokenAccountBalance = await connection.getTokenAccountBalance(
                tokenAccount,
                "confirmed"
            );
            tokenBalance = new Decimal(tokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (tokenBalance.lte(ZERO_DECIMAL)) {
            unitsToSell[i] = null;
            logger.warn(
                "Trader (%s) has insufficient balance: %s %s",
                formatPublicKey(trader.publicKey),
                formatDecimal(tokenBalance.div(10 ** envVars.TOKEN_DECIMALS)),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        const sellPercent = generateRandomFloat(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT);
        unitsToSell[i] = new BN(tokenBalance.mul(sellPercent).toFixed(0));
    }

    return unitsToSell;
}
