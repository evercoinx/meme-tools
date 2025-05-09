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
    DEV_LAMPORTS_TO_DISTRIBUTE,
    envVars,
    heliusClientPool,
    logger,
    pythClient,
    SNIPER_LAMPORTS_TO_DISTRIBUTE,
    TRADER_LAMPORTS_TO_DISTRIBUTE,
    WHALE_LAMPORTS_TO_DISTRIBUTE,
    ZERO_DECIMAL,
} from "../modules";

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

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
        const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);

        if (dryRun) {
            logger.warn("Dry run mode enabled");
            await estimateDevFunds(dev, DEV_LAMPORTS_TO_DISTRIBUTE, usdPriceForSol);
            groupSize = Number.MAX_SAFE_INTEGER;
        }

        const snipers = generateOrImportSwapperKeypairs(
            envVars.SNIPER_POOL_SHARE_PERCENTS.size,
            KeypairKind.Sniper,
            dryRun
        );
        const traders = generateOrImportSwapperKeypairs(
            envVars.TRADER_COUNT,
            KeypairKind.Trader,
            dryRun
        );
        const whales = generateOrImportSwapperKeypairs(
            envVars.WHALE_AMOUNTS_SOL.length,
            KeypairKind.Whale,
            dryRun
        );

        const sendDistributeFundsTransactions = await getSendDistrbiteFundsTransactions(
            snipers,
            sniperDistributor,
            KeypairKind.Sniper,
            groupSize,
            SNIPER_LAMPORTS_TO_DISTRIBUTE,
            usdPriceForSol,
            dryRun
        );
        const sendDistrubuteTraderFundsTransactions = await getSendDistrbiteFundsTransactions(
            traders,
            traderDistributor,
            KeypairKind.Trader,
            groupSize,
            TRADER_LAMPORTS_TO_DISTRIBUTE,
            usdPriceForSol,
            dryRun
        );
        const sendDistrubuteWhaleFundsTransactions = await getSendDistrbiteFundsTransactions(
            whales,
            whaleDistributor,
            KeypairKind.Whale,
            groupSize,
            WHALE_LAMPORTS_TO_DISTRIBUTE,
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

async function estimateDevFunds(
    dev: Keypair,
    lamportsToDistribute: Decimal,
    usdPriceForSol: Decimal
): Promise<void> {
    const solBalance = await getSolBalance(connectionPool, dev);
    if (solBalance.gte(lamportsToDistribute)) {
        logger.info(
            "Dev (%s) has sufficient balance: %s SOL. He must spend %s SOL ($%s)",
            formatPublicKey(dev.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(lamportsToDistribute.div(LAMPORTS_PER_SOL)),
            formatDecimal(
                lamportsToDistribute
                    .div(LAMPORTS_PER_SOL)
                    .mul(usdPriceForSol)
                    .toDP(2, Decimal.ROUND_CEIL)
            )
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

async function estimateDistributorFunds(
    account: Keypair,
    keypairKind: KeypairKind,
    lamportsToDistribute: Decimal,
    fundedAccountCount: number,
    usdPriceForSol: Decimal
): Promise<void> {
    const solBalance = await getSolBalance(connectionPool, account);
    if (solBalance.gte(lamportsToDistribute)) {
        logger.info(
            "%s distributor (%s) has sufficient balance: %s SOL. He must distribute %s SOL ($%s) among %s %ss",
            capitalize(keypairKind),
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            formatDecimal(lamportsToDistribute.div(LAMPORTS_PER_SOL)),
            formatDecimal(
                lamportsToDistribute
                    .div(LAMPORTS_PER_SOL)
                    .mul(usdPriceForSol)
                    .toDP(2, Decimal.ROUND_CEIL)
            ),
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

            fundedAccountCount++;
        }
    }

    const totalLamportsToDistribute = lamports.reduce((sum, value) => sum.add(value), ZERO_DECIMAL);
    if (dryRun) {
        await estimateDistributorFunds(
            distributor,
            keypairKind,
            totalLamportsToDistribute,
            fundedAccountCount,
            usdPriceForSol
        );
        return Promise.resolve(undefined);
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
        `to distribute ${formatDecimal(totalLamportsToDistribute.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(fundedAccountCount)} ${keypairKind}s`
    );
}
