import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionSignature } from "@solana/web3.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import { getSolBalance, importKeypairFromFile, KeypairKind } from "../helpers/account";
import { formatDecimal, formatError, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    MAIN_ACCOUNT_BALANCE_SOL,
    SNIPER_LAMPORTS_TO_DISTRIBUTE,
    TRADER_LAMPORTS_TO_DISTRIBUTE,
    WHALE_LAMPORTS_TO_DISTRIBUTE,
    ZERO_DECIMAL,
} from "../modules";

(async () => {
    try {
        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
        const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);

        const sendTransferFundsTransactions = await transferFunds(dev, [
            [
                sniperDistributor,
                new Decimal(MAIN_ACCOUNT_BALANCE_SOL)
                    .mul(LAMPORTS_PER_SOL)
                    .trunc()
                    .add(
                        SNIPER_LAMPORTS_TO_DISTRIBUTE.reduce(
                            (sum, value) => sum.add(value),
                            ZERO_DECIMAL
                        )
                    ),
            ],
            [
                traderDistributor,
                new Decimal(MAIN_ACCOUNT_BALANCE_SOL)
                    .mul(LAMPORTS_PER_SOL)
                    .trunc()
                    .add(
                        TRADER_LAMPORTS_TO_DISTRIBUTE.reduce(
                            (sum, value) => sum.add(value),
                            ZERO_DECIMAL
                        )
                    ),
            ],
            [
                whaleDistributor,
                new Decimal(MAIN_ACCOUNT_BALANCE_SOL)
                    .mul(LAMPORTS_PER_SOL)
                    .trunc()
                    .add(
                        WHALE_LAMPORTS_TO_DISTRIBUTE.reduce(
                            (sum, value) => sum.add(value),
                            ZERO_DECIMAL
                        )
                    ),
            ],
        ]);
        await Promise.all(sendTransferFundsTransactions);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function transferFunds(
    sender: Keypair,
    recipientLamports: [Keypair, Decimal][]
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];

    const solBalance = await getSolBalance(connectionPool, sender);
    if (solBalance.lte(ZERO_DECIMAL)) {
        logger.warn("Sender (%s) has zero balance on wallet", formatPublicKey(sender.publicKey));
        return [];
    }

    for (const [recipient, lamports] of recipientLamports) {
        const connection = connectionPool.get();
        const heliusClient = heliusClientPool.get();

        const solBalance = await getSolBalance(connectionPool, recipient);
        const lamportsToTransfer = lamports.sub(solBalance);
        if (lamportsToTransfer.lte(ZERO_DECIMAL)) {
            logger.info(
                "Recipient (%s) has sufficient balance: %s SOL",
                formatPublicKey(recipient.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        const instructions = [
            SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: recipient.publicKey,
                lamports: lamports.toNumber(),
            }),
        ];

        const computeBudgetInstructions = await getComputeBudgetInstructions(
            connection,
            envVars.RPC_CLUSTER,
            heliusClient,
            PriorityLevel.DEFAULT,
            instructions,
            [sender]
        );

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [sender],
                `to transfer ${formatDecimal(lamports.div(LAMPORTS_PER_SOL))} SOL from account (${formatPublicKey(sender.publicKey)}) to account (${formatPublicKey(recipient.publicKey)})`
            )
        );
    }

    return sendTransactions;
}
