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
} from "../helpers/account";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import { generateRandomFloat } from "../helpers/random";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    SwapperType,
    ZERO_DECIMAL,
} from "../modules";

(async () => {
    try {
        const distributor = await importKeypairFromFile(
            envVars.KEYPAIR_FILE_PATH_DISTRIBUTOR,
            "distributor"
        );

        const snipers = generateOrImportSwapperKeypairs(
            envVars.SNIPER_POOL_SHARE_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = generateOrImportSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const sniperLamports = envVars.SNIPER_POOL_SHARE_PERCENTS.map((poolSharePercent) =>
            new Decimal(envVars.POOL_LIQUIDITY_SOL)
                .mul(poolSharePercent)
                .add(envVars.SNIPER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
                .trunc()
        );
        const traderLamports = new Array(envVars.TRADER_COUNT)
            .fill(0)
            .map(() =>
                new Decimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1])
                    .mul(envVars.POOL_TRADING_CYCLE_COUNT)
                    .add(generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL))
                    .add(envVars.TRADER_BALANCE_SOL)
                    .mul(LAMPORTS_PER_SOL)
                    .trunc()
            );

        const sendDistrubuteSniperFundsTransaction = await distributeSniperFunds(
            distributor,
            snipers,
            sniperLamports
        );
        const sendDistrubuteTraderFundsTransaction = await distributeTraderFunds(
            distributor,
            traders,
            traderLamports,
            new Decimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1]).mul(LAMPORTS_PER_SOL).trunc()
        );

        await Promise.all([
            sendDistrubuteSniperFundsTransaction,
            sendDistrubuteTraderFundsTransaction,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function distributeSniperFunds(
    distributor: Keypair,
    snipers: Keypair[],
    lamports: Decimal[]
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    let fundedSniperCount = 0;
    let totalLamports = ZERO_DECIMAL;

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, sniper] of snipers.entries()) {
        const solBalance = await getSolBalance(connectionPool, sniper);
        if (solBalance.gt(0)) {
            logger.warn(
                "Sniper (%s) has non zero balance on wallet: %s SOL",
                formatPublicKey(sniper.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: sniper.publicKey,
                    lamports: lamports[i].toNumber(),
                })
            );

            fundedSniperCount++;
            totalLamports = totalLamports.add(lamports[i]);
        }

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        return Promise.resolve(undefined);
    }

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.LOW,
        instructions,
        [distributor]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [distributor],
        `to distribute ${formatDecimal(totalLamports.div(LAMPORTS_PER_SOL))} SOL from distributor (${formatPublicKey(distributor.publicKey)}) to ${formatDecimal(fundedSniperCount, 0)} sniper(s)`
    );
}

async function distributeTraderFunds(
    distributor: Keypair,
    traders: Keypair[],
    lamports: Decimal[],
    minLamports: Decimal
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    let fundedTraderCount = 0;
    let totalLamports = ZERO_DECIMAL;

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, trader] of traders.entries()) {
        const solBalance = await getSolBalance(connectionPool, trader);
        if (solBalance.gte(lamports[i])) {
            logger.warn(
                "Trader (%s) has sufficient balance on wallet: %s SOL",
                formatPublicKey(trader.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            const residualLamports = lamports[i].sub(solBalance);
            if (residualLamports.lt(minLamports)) {
                logger.warn(
                    "Trader (%s) transfer below required mininum: %s SOL",
                    formatPublicKey(trader.publicKey),
                    formatDecimal(minLamports.div(LAMPORTS_PER_SOL))
                );
            } else {
                instructions.push(
                    SystemProgram.transfer({
                        fromPubkey: distributor.publicKey,
                        toPubkey: trader.publicKey,
                        lamports: residualLamports.toNumber(),
                    })
                );

                fundedTraderCount++;
                totalLamports = totalLamports.add(residualLamports);
            }
        }

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        return Promise.resolve(undefined);
    }

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.LOW,
        instructions,
        [distributor]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [distributor],
        `to distribute ${formatDecimal(totalLamports.div(LAMPORTS_PER_SOL))} SOL from distributor (${formatPublicKey(distributor.publicKey)}) to ${formatDecimal(fundedTraderCount, 0)} trader(s)`
    );
}
