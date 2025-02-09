import {
    Commitment,
    ComputeBudgetProgram,
    Keypair,
    SendOptions,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, explorer, logger } from "../modules";
import { formatDecimal, formatPublicKey, formatSignature } from "./format";

interface TransactionOptions extends SendOptions {
    commitment?: Commitment;
}

export async function sendAndConfirmVersionedTransaction(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    prioritizationFee: number,
    options?: TransactionOptions
): Promise<void> {
    const adjustedPrioritizationFee = new Decimal(prioritizationFee)
        .mul(envVars.PRIORITIZATION_FEE_MULTIPLIER)
        .round();
    if (adjustedPrioritizationFee.gt(0)) {
        instructions.unshift(
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: adjustedPrioritizationFee.toNumber(),
            })
        );
    }

    const payer = signers[0];
    let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions,
    });

    let signature: string | undefined;
    let latestErrorMessage: string | undefined;
    let totalRetries = 0;

    do {
        const transaction = new VersionedTransaction(messageV0.compileToV0Message());
        transaction.sign(signers);

        signature = await connection.sendTransaction(transaction, {
            skipPreflight: options?.skipPreflight ?? false,
            preflightCommitment: options?.preflightCommitment ?? "confirmed",
            maxRetries: options?.maxRetries,
            minContextSlot: options?.minContextSlot,
        });

        logger.info(
            "Transaction (%s) sent %s. Prioritization fee: %s microlamports",
            formatSignature(signature),
            logMessage,
            formatDecimal(adjustedPrioritizationFee, 0)
        );

        const confirmation = await connection.confirmTransaction(
            {
                signature,
                blockhash,
                lastValidBlockHeight,
            },
            options?.commitment ?? "confirmed"
        );
        if (confirmation.value.err === null) {
            latestErrorMessage = undefined;
            break;
        }

        ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash());
        messageV0.recentBlockhash = blockhash;
        latestErrorMessage = JSON.stringify(confirmation.value.err, null, 4);
        totalRetries++;

        logger.warn(
            "Transaction (%s) failed. Retry: %d/%d",
            formatPublicKey(signature, 8),
            totalRetries,
            envVars.MAX_TRANSACTION_CONFIRMATION_RETRIES
        );
    } while (totalRetries < envVars.MAX_TRANSACTION_CONFIRMATION_RETRIES);

    if (latestErrorMessage) {
        throw new Error(latestErrorMessage);
    }

    logger.info(
        "Transaction (%s) confirmed: %s",
        formatPublicKey(signature, 8),
        explorer.generateTransactionUri(signature)
    );
}
