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
import { generateRandomFloat } from "../helpers/random";
import { connectionPool, envVars, heliusClientPool, logger, ZERO_DECIMAL } from "../modules";
import { isDryRun } from "../modules/environment";

(async () => {
    try {
        let swapperGroupSize: number;

        const dryRun = isDryRun();
        if (dryRun) {
            logger.warn("Dry run mode enabled");
            swapperGroupSize = Number.MAX_SAFE_INTEGER;
        } else {
            swapperGroupSize = 20;
        }

        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);

        const snipers = generateOrImportSwapperKeypairs(
            envVars.SNIPER_POOL_SHARE_PERCENTS.length,
            KeypairKind.Sniper,
            dryRun
        );
        const traders = generateOrImportSwapperKeypairs(
            envVars.TRADER_COUNT,
            KeypairKind.Trader,
            dryRun
        );

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
                    dryRun
                )
            );
        }

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
                    dryRun
                )
            );
        }

        await Promise.all([
            ...sendDistrubuteSniperFundsTransactions,
            ...sendDistrubuteTraderFundsTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function distributeSwapperFunds(
    distributor: Keypair,
    accounts: Keypair[],
    lamports: Decimal[],
    keypairKind: KeypairKind,
    dryRun: boolean
): Promise<Promise<TransactionSignature | undefined>> {
    const instructions: TransactionInstruction[] = [];
    let totalFundedAccounts = 0;
    let totalLamports = ZERO_DECIMAL;

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, account] of accounts.entries()) {
        const solBalance = await getSolBalance(connectionPool, account);
        if (solBalance.gt(0)) {
            logger.debug(
                "%s (%s) has non zero balance on wallet: %s SOL",
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

            totalFundedAccounts++;
            totalLamports = totalLamports.add(lamports[i]);
        }

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        logger.warn(
            "No funds to distribute among %s %ss",
            formatInteger(accounts.length),
            keypairKind
        );
        return Promise.resolve(undefined);
    }

    if (dryRun) {
        logger.info(
            `Distributing ${formatDecimal(totalLamports.div(LAMPORTS_PER_SOL))} SOL from distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(totalFundedAccounts)} ${keypairKind}s`
        );
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
        `to distribute ${formatDecimal(totalLamports.div(LAMPORTS_PER_SOL))} SOL from distributor (${formatPublicKey(distributor.publicKey)}) to ${formatInteger(totalFundedAccounts)} ${keypairKind}s`
    );
}
