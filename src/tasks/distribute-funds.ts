import {
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import {
    generateOrImportSwapperKeypairs,
    getSolBalance,
    importKeypairFromFile,
    KeypairKind,
} from "../helpers/account";
import {
    capitalize,
    formatDecimal,
    formatError,
    formatInteger,
    formatPublicKey,
} from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    pyth,
    seed,
    ZERO_DECIMAL,
} from "../modules";
import { isDryRun } from "../modules/environment";

const DEV_POOL_CREATION_FEE_SOL = envVars.NODE_ENV === "production" ? 0.15 : 1;
const DEV_GAS_FEE_SOL = 0.1;
const DISTRIBUTOR_GAS_FEE_SOL = 0.01;
const TRANSFER_MULTIPLIER_USD = 1.25;
const TRANSFER_MIN_NATIVE_USD = 1;

(async () => {
    try {
        let swapperGroupSize: number;

        const dryRun = isDryRun();
        const usdPrice = await pyth.getUsdPriceForSol();

        if (dryRun) {
            logger.warn("Dry run mode enabled");

            const dev = await importKeypairFromFile(KeypairKind.Dev);
            const amount = new Decimal(envVars.POOL_LIQUIDITY_SOL)
                .plus(DEV_POOL_CREATION_FEE_SOL)
                .plus(DEV_GAS_FEE_SOL)
                .mul(LAMPORTS_PER_SOL)
                .trunc();

            const solBalance = await getSolBalance(connectionPool, dev);
            if (solBalance.lt(amount)) {
                const residualAmount = amount.sub(solBalance).div(LAMPORTS_PER_SOL);
                logger.info(
                    "Dev (%s) has %s balance: %s SOL. Transfer %s SOL (%s USD)",
                    formatPublicKey(dev.publicKey, "long"),
                    formatError("insufficient"),
                    formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                    formatDecimal(residualAmount),
                    formatDecimal(
                        residualAmount
                            .mul(usdPrice)
                            .mul(TRANSFER_MULTIPLIER_USD)
                            .add(TRANSFER_MIN_NATIVE_USD)
                            .toDP(2, Decimal.ROUND_CEIL)
                    )
                );
            } else {
                logger.info(
                    "Dev (%s) has sufficient balance: %s SOL and must spend %s SOL",
                    formatPublicKey(dev.publicKey, "long"),
                    formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                    formatDecimal(amount.div(LAMPORTS_PER_SOL))
                );
            }

            swapperGroupSize = Number.MAX_SAFE_INTEGER;
        } else {
            swapperGroupSize = 20;
        }

        const sendDistrubuteSniperFundsTransactions = await sendDistributeSniperFunds(
            swapperGroupSize,
            usdPrice,
            dryRun
        );
        const sendDistrubuteTraderFundsTransactions = await sendDistributeTraderFunds(
            swapperGroupSize,
            usdPrice,
            dryRun
        );
        const sendDistrubuteWhaleFundsTransactions = await sendDistributeWhaleFunds(
            swapperGroupSize,
            usdPrice,
            dryRun
        );

        await Promise.all([
            ...sendDistrubuteSniperFundsTransactions,
            ...sendDistrubuteTraderFundsTransactions,
            ...sendDistrubuteWhaleFundsTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function sendDistributeSniperFunds(
    swapperGroupSize: number,
    usdPrice: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
    const snipers = generateOrImportSwapperKeypairs(
        envVars.SNIPER_POOL_SHARE_PERCENTS.size,
        KeypairKind.Sniper,
        dryRun
    );

    const sniperLamports = Array.from(envVars.SNIPER_POOL_SHARE_PERCENTS).map((poolSharePercent) =>
        new Decimal(envVars.POOL_LIQUIDITY_SOL)
            .mul(poolSharePercent)
            .add(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL[1])
            .add(seed.generateRandomFloat(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL))
            .add(envVars.SNIPER_BALANCE_SOL)
            .mul(LAMPORTS_PER_SOL)
            .trunc()
    );
    const sendDistrubuteSniperFundsTransactions = [];

    for (let i = 0; i < snipers.length; i += swapperGroupSize) {
        const sniperGroup = snipers.slice(i, i + swapperGroupSize);
        const sniperGroupLamports = sniperLamports.slice(i, i + swapperGroupSize);

        sendDistrubuteSniperFundsTransactions.push(
            await distributeSwapperFunds(
                sniperDistributor,
                sniperGroup,
                sniperGroupLamports,
                KeypairKind.Sniper,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistrubuteSniperFundsTransactions;
}

async function sendDistributeTraderFunds(
    swapperGroupSize: number,
    usdPrice: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
    const traders = generateOrImportSwapperKeypairs(
        envVars.TRADER_COUNT,
        KeypairKind.Trader,
        dryRun
    );

    const traderLamports = new Array(envVars.TRADER_COUNT)
        .fill(0)
        .map(() =>
            new Decimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1])
                .mul(envVars.POOL_TRADING_CYCLE_COUNT)
                .add(seed.generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL))
                .add(envVars.TRADER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
                .trunc()
        );
    const sendDistrubuteTraderFundsTransactions = [];

    for (let i = 0; i < traders.length; i += swapperGroupSize) {
        const traderGroup = traders.slice(i, i + swapperGroupSize);
        const traderGroupLamports = traderLamports.slice(i, i + swapperGroupSize);

        sendDistrubuteTraderFundsTransactions.push(
            await distributeSwapperFunds(
                traderDistributor,
                traderGroup,
                traderGroupLamports,
                KeypairKind.Trader,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistrubuteTraderFundsTransactions;
}

async function sendDistributeWhaleFunds(
    swapperGroupSize: number,
    usdPrice: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);
    const whales = generateOrImportSwapperKeypairs(
        envVars.WHALE_AMOUNTS_SOL.length,
        KeypairKind.Trader,
        dryRun
    );

    const whaleLamports = Array.from(envVars.WHALE_AMOUNTS_SOL).map((amount) =>
        new Decimal(amount).add(envVars.WHALE_BALANCE_SOL).mul(LAMPORTS_PER_SOL).trunc()
    );
    const sendDistrubuteWhaleFundsTransactions = [];

    for (let i = 0; i < whales.length; i += swapperGroupSize) {
        const whaleGroup = whales.slice(i, i + swapperGroupSize);
        const whaleGroupLamports = whaleLamports.slice(i, i + swapperGroupSize);

        sendDistrubuteWhaleFundsTransactions.push(
            await distributeSwapperFunds(
                whaleDistributor,
                whaleGroup,
                whaleGroupLamports,
                KeypairKind.Whale,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistrubuteWhaleFundsTransactions;
}

async function distributeSwapperFunds(
    distributor: Keypair,
    swappers: Keypair[],
    lamports: Decimal[],
    keypairKind: KeypairKind,
    usdPrice: Decimal,
    dryRun: boolean
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    let totalFundedSwappers = 0;
    let totalLamports = ZERO_DECIMAL;

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, swapper] of swappers.entries()) {
        const solBalance = await getSolBalance(connectionPool, swapper);
        if (solBalance.gt(ZERO_DECIMAL)) {
            logger.debug(
                "%s (%s) has positive balance on wallet: %s SOL",
                capitalize(keypairKind),
                formatPublicKey(swapper.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: swapper.publicKey,
                    lamports: lamports[i].toNumber(),
                })
            );

            totalFundedSwappers++;
            totalLamports = totalLamports.add(lamports[i]);
        }

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        logger.warn(
            "%s distributor (%s) already distributed funds among %s %ss",
            capitalize(keypairKind),
            formatPublicKey(distributor.publicKey, "long"),
            formatInteger(swappers.length),
            keypairKind
        );
        return Promise.resolve(undefined);
    }

    if (dryRun) {
        const solBalance = await getSolBalance(connectionPool, distributor);
        const amount = new Decimal(DISTRIBUTOR_GAS_FEE_SOL)
            .mul(LAMPORTS_PER_SOL)
            .plus(totalLamports);

        if (solBalance.lt(amount)) {
            const residualAmount = amount.sub(solBalance).div(LAMPORTS_PER_SOL);
            logger.info(
                "%s distributor (%s) has %s balance: %s SOL. Transfer %s SOL (%s USD) to distribute among %s %ss",
                capitalize(keypairKind),
                formatPublicKey(distributor.publicKey, "long"),
                formatError("insufficient"),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                formatDecimal(residualAmount),
                formatDecimal(
                    residualAmount
                        .mul(usdPrice)
                        .mul(TRANSFER_MULTIPLIER_USD)
                        .add(TRANSFER_MIN_NATIVE_USD)
                        .toDP(2, Decimal.ROUND_CEIL)
                ),
                formatInteger(totalFundedSwappers),
                keypairKind
            );
        } else {
            logger.info(
                "%s distributor (%s) has sufficient balance: %s SOL and must distribute %s SOL to %s %ss",
                capitalize(keypairKind),
                formatPublicKey(distributor.publicKey, "long"),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                formatDecimal(totalLamports.div(LAMPORTS_PER_SOL)),
                formatInteger(totalFundedSwappers),
                keypairKind
            );
        }

        return Promise.resolve(undefined);
    }

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.DEFAULT,
        instructions,
        [distributor]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [distributor],
        `to distribute ${formatDecimal(totalLamports.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(totalFundedSwappers)} ${keypairKind}s`
    );
}
