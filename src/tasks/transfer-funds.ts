import {
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import { getSolBalance, importKeypairFromFile, KeypairKind } from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
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
    storage,
    ZERO_DECIMAL,
} from "../modules";
import {
    sniperLamportsToDistribute,
    traderLamportsToDistribute,
    whaleLamportsToDistribute,
} from "./distribute-funds";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
        const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);

        const sendTransferFundsTransactions = await transferFunds(dev, [
            [
                sniperDistributor,
                sniperLamportsToDistribute.reduce((sum, value) => sum.add(value), ZERO_DECIMAL),
            ],
            [
                traderDistributor,
                traderLamportsToDistribute.reduce((sum, value) => sum.add(value), ZERO_DECIMAL),
            ],
            [
                whaleDistributor,
                whaleLamportsToDistribute.reduce((sum, value) => sum.add(value), ZERO_DECIMAL),
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
        const lamportsToTransfer = solBalance.sub(lamports);
        if (lamportsToTransfer.lte(ZERO_DECIMAL)) {
            logger.info(
                "Recipient (%s) has sufficient balance: %s SOL",
                formatPublicKey(recipient.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                formatDecimal(lamportsToTransfer.div(LAMPORTS_PER_SOL))
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
