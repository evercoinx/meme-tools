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
} from "../helpers/account";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import { capitalize, formatDecimal, formatPublicKey } from "../helpers/format";
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
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_RAYDIUM_POOL_TRADING_CYCLE,
    SLIPPAGE_PERCENT,
    SwapperType,
    UNITS_PER_MINT,
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
        await checkIfStorageFileExists(storage.cacheId);

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

        let raydiumPoolTradingCycle = storage.get<number | undefined>(
            STORAGE_RAYDIUM_POOL_TRADING_CYCLE
        );
        raydiumPoolTradingCycle = raydiumPoolTradingCycle ? raydiumPoolTradingCycle + 1 : 0;

        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const raydiumPoolTradingCycleCount =
            raydiumPoolTradingCycle + envVars.POOL_TRADING_CYCLE_COUNT;
        for (let i = raydiumPoolTradingCycle; i < raydiumPoolTradingCycleCount; i++) {
            logger.info(
                "\n%s\nTrading cycle #%d (%s mode)\n%s",
                OUTPUT_SEPARATOR,
                i,
                capitalize(envVars.POOL_TRADING_MODE),
                OUTPUT_SEPARATOR
            );

            storage.set(STORAGE_RAYDIUM_POOL_TRADING_CYCLE, i);
            storage.save();
            logger.debug("Raydium pool trading cycle saved to storage");

            await executeTradeCycle(
                poolInfo,
                shuffle(traders),
                mint,
                envVars.POOL_TRADING_MODE,
                envVars.TRADER_GROUP_SIZE,
                i
            );
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function executeTradeCycle(
    poolInfo: CpmmPoolInfo,
    traders: Keypair[],
    mint: Keypair,
    tradingMode: "volume" | "pump" | "dump",
    traderGroupSize: number,
    raydiumPoolTradingCycle: number
): Promise<void> {
    for (let i = 0; i < traders.length; i += traderGroupSize) {
        const traderGroup = shuffle(traders.slice(i, i + traderGroupSize));

        switch (tradingMode) {
            case "volume": {
                if (raydiumPoolTradingCycle === 0 || generateRandomBoolean()) {
                    await pumpPool(poolInfo, traderGroup);
                } else {
                    await dumpPool(poolInfo, traderGroup, mint);
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

        if (i !== traders.length - 1) {
            logger.info(OUTPUT_SEPARATOR);
        }
    }
}

async function pumpPool(poolInfo: CpmmPoolInfo, traderGroup: Keypair[]): Promise<void> {
    const lamportsToBuy = await findLamportsToBuy(traderGroup);
    const sendSwapSolToMintTransactions = await swapSolToMint(
        connectionPool,
        heliusClientPool,
        poolInfo,
        traderGroup,
        lamportsToBuy,
        SLIPPAGE_PERCENT,
        PriorityLevel.LOW
    );
    if (sendSwapSolToMintTransactions.length === 0) {
        logger.debug("No buy transactions found. Skipping");
        return;
    }

    await Promise.all(sendSwapSolToMintTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "%s buy transaction(s) executed. Pausing: %s sec",
            formatDecimal(sendSwapSolToMintTransactions.length, 0),
            formatDecimal(delay / 1_000, 3)
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
    poolInfo: CpmmPoolInfo,
    traderGroup: Keypair[],
    mint: Keypair
): Promise<void> {
    const unitsToSell = await findUnitsToSell(traderGroup, mint);
    const sendSwapMintToSolTransactions = await swapMintToSol(
        connectionPool,
        heliusClientPool,
        poolInfo,
        traderGroup,
        unitsToSell,
        SLIPPAGE_PERCENT,
        PriorityLevel.LOW
    );
    if (sendSwapMintToSolTransactions.length === 0) {
        logger.debug("No sell transactions found. Skipping");
        return;
    }

    await Promise.all(sendSwapMintToSolTransactions);

    await new Promise((resolve) => {
        const delay = generateRandomInteger(envVars.TRADER_SWAP_DELAY_RANGE_SEC);
        logger.info(
            "%s sell transaction(s) executed. Pausing: %s sec",
            formatDecimal(sendSwapMintToSolTransactions.length, 0),
            formatDecimal(delay / 1_000, 3)
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
