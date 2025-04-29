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

(async () => {
    try {
        let groupSize: number;

        const dryRun = isDryRun();
        const usdPrice = await pyth.getUsdPriceForSol();

        if (dryRun) {
            logger.warn("Dry run mode enabled");
            await showDistributeDevFunds(usdPrice);
            groupSize = Number.MAX_SAFE_INTEGER;
        } else {
            groupSize = 20;
        }

        const sendDistributeFundsTransactions = await sendDistributeSniperFunds(
            groupSize,
            usdPrice,
            dryRun
        );
        const sendDistrubuteTraderFundsTransactions = await sendDistributeTraderFunds(
            groupSize,
            usdPrice,
            dryRun
        );
        const sendDistrubuteWhaleFundsTransactions = await sendDistributeWhaleFunds(
            groupSize,
            usdPrice,
            dryRun
        );

        await Promise.all([
            ...sendDistributeFundsTransactions,
            ...sendDistrubuteTraderFundsTransactions,
            ...sendDistrubuteWhaleFundsTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function showDistributeDevFunds(usdPrice: Decimal): Promise<void> {
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
            formatDecimal(residualAmount.mul(usdPrice).toDP(2, Decimal.ROUND_CEIL))
        );
    } else {
        logger.info(
            "Dev (%s) has sufficient balance: %s SOL and must spend %s SOL",
            formatPublicKey(dev.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(amount.div(LAMPORTS_PER_SOL))
        );
    }
}

async function showDistributeDistributorFunds(
    account: Keypair,
    fundedLamports: Decimal,
    fundedAccountCount: number,
    usdPrice: Decimal,
    keypairKind: KeypairKind
): Promise<void> {
    const solBalance = await getSolBalance(connectionPool, account);
    const amount = new Decimal(DISTRIBUTOR_GAS_FEE_SOL).mul(LAMPORTS_PER_SOL).plus(fundedLamports);

    if (solBalance.lt(amount)) {
        const residualAmount = amount.sub(solBalance).div(LAMPORTS_PER_SOL);
        logger.info(
            "%s distributor (%s) has %s balance: %s SOL. Transfer %s SOL (%s USD) to distribute among %s %ss",
            capitalize(keypairKind),
            formatPublicKey(account.publicKey, "long"),
            formatError("insufficient"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(residualAmount),
            formatDecimal(residualAmount.mul(usdPrice).toDP(2, Decimal.ROUND_CEIL)),
            formatInteger(fundedAccountCount),
            keypairKind
        );
    } else {
        logger.info(
            "%s distributor (%s) has sufficient balance: %s SOL and must distribute %s SOL to %s %ss",
            capitalize(keypairKind),
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(fundedLamports.div(LAMPORTS_PER_SOL)),
            formatInteger(fundedAccountCount),
            keypairKind
        );
    }
}

async function sendDistributeSniperFunds(
    groupSize: number,
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
    const sendDistributeFundsTransactions = [];

    for (let i = 0; i < snipers.length; i += groupSize) {
        const sniperGroup = snipers.slice(i, i + groupSize);
        const sniperGroupLamports = sniperLamports.slice(i, i + groupSize);

        sendDistributeFundsTransactions.push(
            await distributeFunds(
                sniperDistributor,
                sniperGroup,
                sniperGroupLamports,
                KeypairKind.Sniper,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistributeFundsTransactions;
}

async function sendDistributeTraderFunds(
    groupSize: number,
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
    const sendDistrubuteFundsTransactions = [];

    for (let i = 0; i < traders.length; i += groupSize) {
        const traderGroup = traders.slice(i, i + groupSize);
        const traderGroupLamports = traderLamports.slice(i, i + groupSize);

        sendDistrubuteFundsTransactions.push(
            await distributeFunds(
                traderDistributor,
                traderGroup,
                traderGroupLamports,
                KeypairKind.Trader,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistrubuteFundsTransactions;
}

async function sendDistributeWhaleFunds(
    groupSize: number,
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
    const sendDistrubuteFundsTransactions = [];

    for (let i = 0; i < whales.length; i += groupSize) {
        const whaleGroup = whales.slice(i, i + groupSize);
        const whaleGroupLamports = whaleLamports.slice(i, i + groupSize);

        sendDistrubuteFundsTransactions.push(
            await distributeFunds(
                whaleDistributor,
                whaleGroup,
                whaleGroupLamports,
                KeypairKind.Whale,
                usdPrice,
                dryRun
            )
        );
    }

    return sendDistrubuteFundsTransactions;
}

async function distributeFunds(
    distributor: Keypair,
    accounts: Keypair[],
    lamports: Decimal[],
    keypairKind: KeypairKind,
    usdPrice: Decimal,
    dryRun: boolean
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    let totalFundedLamports = ZERO_DECIMAL;
    let totalFundedAccounts = 0;
    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, account] of accounts.entries()) {
        const solBalance = await getSolBalance(connectionPool, account);
        if (solBalance.gt(ZERO_DECIMAL)) {
            logger.debug(
                "%s (%s) has positive balance on wallet: %s SOL",
                capitalize(keypairKind),
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: account.publicKey,
                    lamports: lamports[i].toNumber(),
                })
            );

            totalFundedLamports = totalFundedLamports.add(lamports[i]);
            totalFundedAccounts++;
        }

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        logger.warn(
            "%s distributor (%s) already distributed funds among %s %ss",
            capitalize(keypairKind),
            formatPublicKey(distributor.publicKey, "long"),
            formatInteger(accounts.length),
            keypairKind
        );
        return Promise.resolve(undefined);
    }

    if (dryRun) {
        showDistributeDistributorFunds(
            distributor,
            totalFundedLamports,
            totalFundedAccounts,
            usdPrice,
            keypairKind
        );
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
        `to distribute ${formatDecimal(totalFundedLamports.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(totalFundedAccounts)} ${keypairKind}s`
    );
}
