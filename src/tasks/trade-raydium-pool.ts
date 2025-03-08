import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import {
    getSolBalance,
    getTokenAccountInfo,
    importMintKeypair,
    importSwapperKeypairs,
    KeypairKind,
} from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
import {
    formatDecimal,
    formatError,
    formatInteger,
    formatMilliseconds,
    formatPercent,
    formatPublicKey,
} from "../helpers/format";
import {
    generateRandomBoolean,
    generateRandomFloat,
    generateRandomInteger,
    shuffle,
} from "../helpers/random";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    OUTPUT_SEPARATOR,
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    UNITS_PER_MINT,
    ZERO_DECIMAL,
} from "../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RaydiumCpmmPool,
    swapMintToSol,
    swapSolToMint,
} from "../modules/raydium";
import {
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_RAYDIUM_POOL_TRADING_CYCLE,
    STORAGE_TRADER_COUNT,
} from "../modules/storage";

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

        const traderCount = storage.get<number | undefined>(STORAGE_TRADER_COUNT);
        if (traderCount && envVars.TRADER_COUNT > traderCount) {
            throw new Error(
                `${formatInteger(envVars.TRADER_COUNT - traderCount)} traders have no funds`
            );
        }

        const traders = importSwapperKeypairs(KeypairKind.Trader);
        const raydium = await createRaydium(connectionPool.current());
        const raydiumCpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(raydiumPoolId));

        let poolTradingCycle = storage.get<number | undefined>(STORAGE_RAYDIUM_POOL_TRADING_CYCLE);
        poolTradingCycle = poolTradingCycle ? poolTradingCycle + 1 : 0;

        const poolTradingCycleCount = poolTradingCycle + envVars.POOL_TRADING_CYCLE_COUNT;
        const poolTradingPumpBiasPercent = new Decimal(envVars.POOL_TRADING_PUMP_BIAS_PERCENT)
            .mul(100)
            .round()
            .toNumber();

        for (let i = poolTradingCycle; i < poolTradingCycleCount; i++) {
            const activeTraders = shuffle(traders).slice(0, envVars.TRADER_COUNT);

            logger.info(
                "\n%s\nTrading cycle: %s. Total trades: %s. Pump bias: %s\n%s",
                OUTPUT_SEPARATOR,
                formatInteger(i),
                formatInteger(activeTraders.length),
                formatPercent(envVars.POOL_TRADING_PUMP_BIAS_PERCENT),
                OUTPUT_SEPARATOR
            );

            storage.set(STORAGE_RAYDIUM_POOL_TRADING_CYCLE, i);
            storage.save();
            logger.debug("Raydium pool trading cycle saved to storage");

            await executeTradeCycle(
                raydium,
                raydiumCpmmPool,
                activeTraders,
                mint,
                envVars.TRADER_GROUP_SIZE,
                i,
                poolTradingPumpBiasPercent
            );
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function executeTradeCycle(
    raydium: Raydium,
    raydiumCpmmPool: RaydiumCpmmPool,
    traders: Keypair[],
    mint: Keypair,
    traderGroupSize: number,
    poolTradingCycle: number,
    poolTradingPumpBiasPercent: number
): Promise<void> {
    for (let i = 0; i < traders.length; i += traderGroupSize) {
        const traderGroup = shuffle(traders.slice(i, i + traderGroupSize));

        if (poolTradingCycle === 0 || generateRandomBoolean(poolTradingPumpBiasPercent)) {
            await pumpPool(
                raydium,
                raydiumCpmmPool,
                traderGroup,
                poolTradingCycle,
                i + 1,
                traders.length
            );
        } else {
            await dumpPool(
                raydium,
                raydiumCpmmPool,
                traderGroup,
                mint,
                poolTradingCycle,
                i + 1,
                traders.length
            );
        }

        if (i !== traders.length - 1) {
            logger.info(OUTPUT_SEPARATOR);
        }
    }
}

async function pumpPool(
    raydium: Raydium,
    raydiumCpmmPool: RaydiumCpmmPool,
    traders: Keypair[],
    poolTradingCycle: number,
    tradeNumber: number,
    totalTrades: number
): Promise<void> {
    const lamportsToBuy = await findLamportsToBuy(traders);
    const sendSwapSolToMintTransactions = await swapSolToMint(
        connectionPool,
        heliusClientPool,
        raydium,
        raydiumCpmmPool,
        traders,
        lamportsToBuy,
        SWAPPER_SLIPPAGE_PERCENT,
        PriorityLevel.LOW
    );
    if (sendSwapSolToMintTransactions.length === 0) {
        logger.warn(
            "Cycle: %s. Trade: %s/%s. No buy transactions found. Skipping",
            formatInteger(poolTradingCycle),
            formatInteger(tradeNumber),
            formatInteger(totalTrades)
        );
        return;
    }

    await Promise.all(sendSwapSolToMintTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "Cycle: %s. Trade: %s/%s. Buy transactions executed: %s. Pausing: %s sec",
            formatInteger(poolTradingCycle),
            formatInteger(tradeNumber),
            formatInteger(totalTrades),
            formatInteger(sendSwapSolToMintTransactions.length),
            formatMilliseconds(delay)
        );
        setTimeout(resolve, delay);
    });
}

async function findLamportsToBuy(traders: Keypair[]): Promise<(BN | null)[]> {
    const lamportsToBuy: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const solBalance = await getSolBalance(connectionPool, trader);
        const buyAmount = new Decimal(generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL)).mul(
            LAMPORTS_PER_SOL
        );
        const minSolBalance = new Decimal(envVars.TRADER_BALANCE_SOL).mul(LAMPORTS_PER_SOL);

        if (solBalance.sub(buyAmount).lt(minSolBalance)) {
            lamportsToBuy[i] = null;
            logger.warn(
                "Trader (%s) has insufficient balance on wallet: %s SOL",
                formatPublicKey(trader.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        lamportsToBuy[i] = new BN(buyAmount.toFixed(0));
    }

    return lamportsToBuy;
}

async function dumpPool(
    raydium: Raydium,
    raydiumCpmmPool: RaydiumCpmmPool,
    traders: Keypair[],
    mint: Keypair,
    poolTradingCycle: number,
    tradeNumber: number,
    totalTrades: number
): Promise<void> {
    const unitsToSell = await findUnitsToSell(traders, mint);
    const sendSwapMintToSolTransactions = await swapMintToSol(
        connectionPool,
        heliusClientPool,
        raydium,
        raydiumCpmmPool,
        traders,
        unitsToSell,
        SWAPPER_SLIPPAGE_PERCENT,
        PriorityLevel.LOW
    );
    if (sendSwapMintToSolTransactions.length === 0) {
        logger.warn(
            "Cycle: %s. Trade: %s/%s. No sell transactions found. Skipping",
            formatInteger(poolTradingCycle),
            formatInteger(tradeNumber),
            formatInteger(totalTrades)
        );
        return;
    }

    await Promise.all(sendSwapMintToSolTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "Cycle: %s. Trade: %s/%s. Sell transactions executed: %s. Pausing: %s sec",
            formatInteger(poolTradingCycle),
            formatInteger(tradeNumber),
            formatInteger(totalTrades),
            formatInteger(sendSwapMintToSolTransactions.length),
            formatMilliseconds(delay)
        );
        setTimeout(resolve, delay);
    });
}

async function findUnitsToSell(traders: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSell: (BN | null)[] = [];

    for (const [i, trader] of traders.entries()) {
        const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
            connectionPool,
            trader,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        );

        if (!mintTokenBalance) {
            unitsToSell[i] = null;
            logger.warn(
                "Trader (%s) has uninitialized %s ATA (%s)",
                formatPublicKey(trader.publicKey),
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount)
            );
            continue;
        }
        if (mintTokenBalance.lte(ZERO_DECIMAL)) {
            unitsToSell[i] = null;
            logger.warn(
                "Trader (%s) has insufficient balance on ATA (%s): %s %s",
                formatPublicKey(trader.publicKey),
                formatPublicKey(mintTokenAccount),
                formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        const sellPercent = generateRandomFloat(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT);
        unitsToSell[i] = new BN(mintTokenBalance.mul(sellPercent).toFixed(0));
    }

    return unitsToSell;
}
