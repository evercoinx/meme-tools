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
} from "../../helpers/account";
import { checkFileExists } from "../../helpers/filesystem";
import {
    capitalize,
    formatDecimal,
    formatError,
    formatInteger,
    formatMilliseconds,
    formatPercent,
    formatPublicKey,
    OUTPUT_SEPARATOR_DOUBLE,
    OUTPUT_SEPARATOR_SINGLE,
} from "../../helpers/format";
import {
    generateRandomBoolean,
    generateRandomFloat,
    generateRandomInteger,
    shuffle,
} from "../../helpers/random";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    UNITS_PER_MINT,
    ZERO_DECIMAL,
} from "../../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RaydiumCpmmPool,
    swapMintToSol,
    swapSolToMint,
} from "../../modules/raydium";
import {
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_RAYDIUM_POOL_TRADING_CYCLE,
    STORAGE_TRADER_COUNT,
} from "../../modules/storage";

const SNIPER_BUY_TRADING_CYCLE = 1;
const SNIPER_SELL_TRADING_CYCLE = 2;
const SWAPPER_MIN_BALANCE_DIVISOR = 2;

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

        const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!lpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const traderCount = storage.get<number | undefined>(STORAGE_TRADER_COUNT);
        if (traderCount !== undefined && envVars.TRADER_COUNT > traderCount) {
            throw new Error(
                `${formatInteger(envVars.TRADER_COUNT - traderCount)} traders have undistributed funds`
            );
        }
        if (traderCount === 0) {
            throw new Error("No traders assigned to trade on this pool");
        }

        if (envVars.POOL_TRADING_ONLY_NEW_TRADERS) {
            logger.warn("Only new traders mode enabled");
        }

        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const traders = importSwapperKeypairs(KeypairKind.Trader);
        const raydium = await createRaydium(connectionPool.current());
        const cpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(poolId));

        let poolTradingCycle = storage.get<number | undefined>(STORAGE_RAYDIUM_POOL_TRADING_CYCLE);
        poolTradingCycle = poolTradingCycle ? poolTradingCycle + 1 : 0;

        const poolTradingCycleCount = poolTradingCycle + envVars.POOL_TRADING_CYCLE_COUNT;
        const poolTradingPumpBiasPercent = new Decimal(envVars.POOL_TRADING_PUMP_BIAS_PERCENT)
            .mul(100)
            .round()
            .toNumber();

        for (let i = poolTradingCycle; i < poolTradingCycleCount; i++) {
            storage.set(STORAGE_RAYDIUM_POOL_TRADING_CYCLE, i);
            storage.save();
            logger.debug("Raydium pool trading cycle saved to storage");

            if (i === SNIPER_BUY_TRADING_CYCLE && envVars.SNIPER_REPEATABLE_BUY_PERCENT > 0) {
                const sniperRepeatableCount = new Decimal(envVars.SNIPER_REPEATABLE_BUY_PERCENT)
                    .mul(snipers.length)
                    .round()
                    .toNumber();
                const activeSnipers = shuffle(snipers).slice(0, sniperRepeatableCount);

                await executeSniperCycle(
                    raydium,
                    cpmmPool,
                    activeSnipers,
                    mint,
                    envVars.SWAPPER_GROUP_SIZE,
                    i,
                    true
                );
            } else if (
                i === SNIPER_SELL_TRADING_CYCLE &&
                envVars.SNIPER_REPEATABLE_SELL_PERCENT > 0
            ) {
                const sniperRepeatableCount = new Decimal(envVars.SNIPER_REPEATABLE_SELL_PERCENT)
                    .mul(snipers.length)
                    .round()
                    .toNumber();
                const activeSnipers = shuffle(snipers).slice(0, sniperRepeatableCount);

                await executeSniperCycle(
                    raydium,
                    cpmmPool,
                    activeSnipers,
                    mint,
                    envVars.SWAPPER_GROUP_SIZE,
                    i,
                    false
                );
            }

            const activeTraders = shuffle(traders).slice(0, envVars.TRADER_COUNT);
            await executeTraderCycle(
                raydium,
                cpmmPool,
                activeTraders,
                mint,
                envVars.SWAPPER_GROUP_SIZE,
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

async function executeSniperCycle(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    snipers: Keypair[],
    mint: Keypair,
    sniperGroupSize: number,
    poolTradingCycle: number,
    pumpTrade: boolean
): Promise<void> {
    logger.info(
        "\n%s\nTrading cycle: %s. Total sniper swaps: %s. Pump bias: %s\n%s",
        OUTPUT_SEPARATOR_DOUBLE,
        formatInteger(poolTradingCycle),
        formatInteger(snipers.length),
        formatPercent(poolTradingCycle === SNIPER_BUY_TRADING_CYCLE ? 1 : 0),
        OUTPUT_SEPARATOR_DOUBLE
    );

    for (let i = 0; i < snipers.length; i += sniperGroupSize) {
        const sniperGroup = snipers.slice(i, i + sniperGroupSize);

        if (pumpTrade) {
            await pumpPool(
                raydium,
                cpmmPool,
                sniperGroup,
                mint,
                KeypairKind.Sniper,
                poolTradingCycle,
                i + 1,
                snipers.length
            );
        } else {
            await dumpPool(
                raydium,
                cpmmPool,
                sniperGroup,
                mint,
                KeypairKind.Sniper,
                poolTradingCycle,
                i + 1,
                snipers.length
            );
        }

        if (i !== snipers.length - 1) {
            logger.info(OUTPUT_SEPARATOR_SINGLE);
        }
    }
}

async function executeTraderCycle(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    traders: Keypair[],
    mint: Keypair,
    traderGroupSize: number,
    poolTradingCycle: number,
    poolTradingPumpBiasPercent: number
): Promise<void> {
    logger.info(
        "\n%s\nTrading cycle: %s. Total trader swaps: %s. Pump bias: %s\n%s",
        OUTPUT_SEPARATOR_DOUBLE,
        formatInteger(poolTradingCycle),
        formatInteger(traders.length),
        formatPercent(envVars.POOL_TRADING_PUMP_BIAS_PERCENT),
        OUTPUT_SEPARATOR_DOUBLE
    );

    for (let i = 0; i < traders.length; i += traderGroupSize) {
        const traderGroup = traders.slice(i, i + traderGroupSize);

        if (poolTradingCycle === 0 || generateRandomBoolean(poolTradingPumpBiasPercent)) {
            await pumpPool(
                raydium,
                cpmmPool,
                traderGroup,
                mint,
                KeypairKind.Trader,
                poolTradingCycle,
                i + 1,
                traders.length
            );
        } else {
            await dumpPool(
                raydium,
                cpmmPool,
                traderGroup,
                mint,
                KeypairKind.Trader,
                poolTradingCycle,
                i + 1,
                traders.length
            );
        }

        if (i !== traders.length - 1) {
            logger.info(OUTPUT_SEPARATOR_SINGLE);
        }
    }
}

async function pumpPool(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    swappers: Keypair[],
    mint: Keypair,
    keypairKind: KeypairKind,
    poolTradingCycle: number,
    tradeNumber: number,
    totalTrades: number
): Promise<void> {
    const lamportsToBuy = await findLamportsToBuy(swappers, mint, keypairKind);
    const sendSwapSolToMintTransactions = await swapSolToMint(
        connectionPool,
        heliusClientPool,
        raydium,
        cpmmPool,
        swappers,
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
        const delay = generateRandomInteger(envVars.SWAPPER_TRADE_DELAY_RANGE_SEC);
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

async function dumpPool(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    swappers: Keypair[],
    mint: Keypair,
    keypairKind: KeypairKind,
    poolTradingCycle: number,
    tradeNumber: number,
    totalTrades: number
): Promise<void> {
    const unitsToSell = await findUnitsToSell(swappers, mint, keypairKind);
    const sendSwapMintToSolTransactions = await swapMintToSol(
        connectionPool,
        heliusClientPool,
        raydium,
        cpmmPool,
        swappers,
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
        const delay = generateRandomInteger(envVars.SWAPPER_TRADE_DELAY_RANGE_SEC);
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

async function findLamportsToBuy(
    swappers: Keypair[],
    mint: Keypair,
    keypairKind: KeypairKind
): Promise<(BN | null)[]> {
    const lamportsToBuy: (BN | null)[] = [];
    const isSniper = keypairKind === KeypairKind.Sniper;

    for (const [i, swapper] of swappers.entries()) {
        const solBalance = await getSolBalance(connectionPool, swapper);
        const buyAmount = new Decimal(
            generateRandomFloat(
                isSniper
                    ? envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL
                    : envVars.TRADER_BUY_AMOUNT_RANGE_SOL
            )
        ).mul(LAMPORTS_PER_SOL);

        const minSolBalance = new Decimal(
            isSniper ? envVars.SNIPER_BALANCE_SOL : envVars.TRADER_BALANCE_SOL
        )
            .div(SWAPPER_MIN_BALANCE_DIVISOR)
            .mul(LAMPORTS_PER_SOL)
            .trunc();

        if (solBalance.sub(buyAmount).lt(minSolBalance)) {
            lamportsToBuy[i] = null;
            logger.warn(
                "%s (%s) has insufficient balance on wallet: %s SOL",
                capitalize(keypairKind),
                formatPublicKey(swapper.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        if (keypairKind === KeypairKind.Trader && envVars.POOL_TRADING_ONLY_NEW_TRADERS) {
            const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
                connectionPool,
                swapper,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );

            if (mintTokenBalance && mintTokenBalance.gt(ZERO_DECIMAL)) {
                lamportsToBuy[i] = null;
                logger.warn(
                    "%s (%s) already bought token on ATA (%s): %s %s",
                    capitalize(keypairKind),
                    formatPublicKey(swapper.publicKey),
                    formatPublicKey(mintTokenAccount),
                    formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                    envVars.TOKEN_SYMBOL
                );
                continue;
            }
        }

        lamportsToBuy[i] = new BN(buyAmount.toFixed(0));
    }

    return lamportsToBuy;
}

async function findUnitsToSell(
    swappers: Keypair[],
    mint: Keypair,
    keypairKind: KeypairKind
): Promise<(BN | null)[]> {
    const unitsToSell: (BN | null)[] = [];
    const isSniper = keypairKind === KeypairKind.Sniper;

    for (const [i, swapper] of swappers.entries()) {
        const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
            connectionPool,
            swapper,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        );

        if (!mintTokenBalance) {
            unitsToSell[i] = null;
            logger.warn(
                "%s (%s) has uninitialized %s ATA (%s)",
                capitalize(keypairKind),
                formatPublicKey(swapper.publicKey),
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
                formatPublicKey(swapper.publicKey),
                formatPublicKey(mintTokenAccount),
                formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }
        if (envVars.POOL_TRADING_ONLY_NEW_TRADERS && mintTokenBalance.gt(ZERO_DECIMAL)) {
            unitsToSell[i] = null;
            logger.warn(
                "%s (%s) already bought token on ATA (%s): %s %s",
                capitalize(keypairKind),
                formatPublicKey(swapper.publicKey),
                formatPublicKey(mintTokenAccount),
                formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                envVars.TOKEN_SYMBOL
            );
            continue;
        }

        const sellPercent = generateRandomFloat(
            isSniper
                ? envVars.SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT
                : envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT
        );
        unitsToSell[i] = new BN(mintTokenBalance.mul(sellPercent).toFixed(0));
    }

    return unitsToSell;
}
