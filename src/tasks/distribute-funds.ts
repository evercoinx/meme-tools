import { parseArgs } from "node:util";
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
    pythClient,
    tokenSeed,
    ZERO_DECIMAL,
} from "../modules";

const DEV_BALANCE_SOL = 0.1;
const DISTRIBUTOR_BALANCE_SOL = 0.01;
const RAYDIUM_POOL_CREATION_FEE_SOL = envVars.NODE_ENV === "production" ? 0.15 : 1;

(async () => {
    try {
        const {
            values: { "dry-run": dryRun },
        } = parseArgs({
            options: {
                "dry-run": {
                    type: "boolean",
                    default: false,
                },
            },
        });

        const usdPriceForSol = await pythClient.getUsdPriceForSol();
        let groupSize = 20;

        if (dryRun) {
            logger.warn("Dry run mode enabled");
            await showDistributeDevFunds(usdPriceForSol);
            groupSize = Number.MAX_SAFE_INTEGER;
        }

        const sendDistributeFundsTransactions = await sendDistributeSniperFunds(
            groupSize,
            usdPriceForSol,
            dryRun
        );
        const sendDistrubuteTraderFundsTransactions = await sendDistributeTraderFunds(
            groupSize,
            usdPriceForSol,
            dryRun
        );
        const sendDistrubuteWhaleFundsTransactions = await sendDistributeWhaleFunds(
            groupSize,
            usdPriceForSol,
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

async function showDistributeDevFunds(usdPriceForSol: Decimal): Promise<void> {
    const dev = await importKeypairFromFile(KeypairKind.Dev);
    const lamportsToDistribute = new Decimal(envVars.POOL_LIQUIDITY_SOL)
        .plus(DEV_BALANCE_SOL)
        .plus(RAYDIUM_POOL_CREATION_FEE_SOL)
        .mul(LAMPORTS_PER_SOL)
        .trunc();

    const solBalance = await getSolBalance(connectionPool, dev);
    if (solBalance.gte(lamportsToDistribute)) {
        logger.info(
            "Dev (%s) has sufficient balance: %s SOL. He must spend %s SOL",
            formatPublicKey(dev.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(lamportsToDistribute.div(LAMPORTS_PER_SOL))
        );
        return;
    }

    const solToDistribute = lamportsToDistribute.sub(solBalance).div(LAMPORTS_PER_SOL);
    logger.info(
        "Dev (%s) has %s balance: %s SOL. Transfer %s SOL ($%s)",
        formatPublicKey(dev.publicKey, "long"),
        formatError("insufficient"),
        formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
        formatDecimal(solToDistribute),
        formatDecimal(solToDistribute.mul(usdPriceForSol).toDP(2, Decimal.ROUND_CEIL))
    );
}

async function showDistributeDistributorFunds(
    account: Keypair,
    fundedLamports: Decimal,
    fundedAccountCount: number,
    usdPriceForSol: Decimal,
    keypairKind: KeypairKind
): Promise<void> {
    const solBalance = await getSolBalance(connectionPool, account);
    const lamportsToDistribute = new Decimal(DISTRIBUTOR_BALANCE_SOL)
        .mul(LAMPORTS_PER_SOL)
        .plus(fundedLamports);

    if (solBalance.gte(lamportsToDistribute)) {
        logger.info(
            "%s distributor (%s) has sufficient balance: %s SOL. He must distribute %s SOL to %s %ss",
            capitalize(keypairKind),
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(fundedLamports.div(LAMPORTS_PER_SOL)),
            formatInteger(fundedAccountCount),
            keypairKind
        );
        return;
    }

    const solToDistribute = lamportsToDistribute.sub(solBalance).div(LAMPORTS_PER_SOL);
    logger.info(
        "%s distributor (%s) has %s balance: %s SOL. Transfer %s SOL ($%s) to distribute among %s %ss",
        capitalize(keypairKind),
        formatPublicKey(account.publicKey, "long"),
        formatError("insufficient"),
        formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
        formatDecimal(solToDistribute),
        formatDecimal(solToDistribute.mul(usdPriceForSol).toDP(2, Decimal.ROUND_CEIL)),
        formatInteger(fundedAccountCount),
        keypairKind
    );
}

async function sendDistributeSniperFunds(
    groupSize: number,
    usdPriceForSol: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
    const snipers = generateOrImportSwapperKeypairs(
        envVars.SNIPER_POOL_SHARE_PERCENTS.size,
        KeypairKind.Sniper,
        dryRun
    );

    const lamportsToDistribute = Array.from(envVars.SNIPER_POOL_SHARE_PERCENTS).map(
        (poolSharePercent) =>
            new Decimal(envVars.POOL_LIQUIDITY_SOL)
                .mul(poolSharePercent)
                .add(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL[1])
                .add(tokenSeed.generateRandomFloat(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL))
                .add(envVars.SNIPER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
                .trunc()
    );

    return await getSendDistrbiteFundsTransactions(
        snipers,
        sniperDistributor,
        KeypairKind.Sniper,
        groupSize,
        lamportsToDistribute,
        usdPriceForSol,
        dryRun
    );
}

async function sendDistributeTraderFunds(
    groupSize: number,
    usdPriceForSol: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
    const traders = generateOrImportSwapperKeypairs(
        envVars.TRADER_COUNT,
        KeypairKind.Trader,
        dryRun
    );

    const lamportsToDistribute = new Array(envVars.TRADER_COUNT)
        .fill(0)
        .map(() =>
            new Decimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1])
                .mul(envVars.POOL_TRADING_CYCLE_COUNT)
                .add(tokenSeed.generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL))
                .add(envVars.TRADER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
                .trunc()
        );

    return await getSendDistrbiteFundsTransactions(
        traders,
        traderDistributor,
        KeypairKind.Trader,
        groupSize,
        lamportsToDistribute,
        usdPriceForSol,
        dryRun
    );
}

async function sendDistributeWhaleFunds(
    groupSize: number,
    usdPriceForSol: Decimal,
    dryRun: boolean
): Promise<(TransactionSignature | undefined)[]> {
    const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);
    const whales = generateOrImportSwapperKeypairs(
        envVars.WHALE_AMOUNTS_SOL.length,
        KeypairKind.Whale,
        dryRun
    );

    const lamportsToDistribute = envVars.WHALE_AMOUNTS_SOL.map((amount) =>
        new Decimal(amount).add(envVars.WHALE_BALANCE_SOL).mul(LAMPORTS_PER_SOL).trunc()
    );

    return await getSendDistrbiteFundsTransactions(
        whales,
        whaleDistributor,
        KeypairKind.Whale,
        groupSize,
        lamportsToDistribute,
        usdPriceForSol,
        dryRun
    );
}

async function getSendDistrbiteFundsTransactions(
    accounts: Keypair[],
    distributor: Keypair,
    keypairKind: KeypairKind,
    groupSize: number,
    lamports: Decimal[],
    usdPriceForSol: Decimal,
    dryRun: boolean
) {
    const sendDistributeFundsTransactions = [];

    for (let i = 0; i < accounts.length; i += groupSize) {
        const group = accounts.slice(i, i + groupSize);
        const groupLamports = lamports.slice(i, i + groupSize);

        sendDistributeFundsTransactions.push(
            await distributeFunds(
                distributor,
                group,
                groupLamports,
                keypairKind,
                usdPriceForSol,
                dryRun
            )
        );
    }

    return sendDistributeFundsTransactions;
}

async function distributeFunds(
    distributor: Keypair,
    accounts: Keypair[],
    lamports: Decimal[],
    keypairKind: KeypairKind,
    usdPriceForSol: Decimal,
    dryRun: boolean
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    const connection = connectionPool.get();
    const heliusClient = heliusClientPool.get();
    let fundedLamportsTotal = ZERO_DECIMAL;
    let fundedAccountCount = 0;

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

            fundedLamportsTotal = fundedLamportsTotal.add(lamports[i]);
            fundedAccountCount++;
        }
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
        await showDistributeDistributorFunds(
            distributor,
            fundedLamportsTotal,
            fundedAccountCount,
            usdPriceForSol,
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
        `to distribute ${formatDecimal(fundedLamportsTotal.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(fundedAccountCount)} ${keypairKind}s`
    );
}
