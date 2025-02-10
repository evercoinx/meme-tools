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

interface PrioritizationFee {
    amount: number;
    multiplierIndex: number;
}

export async function sendAndConfirmVersionedTransaction(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    prioritizationFee?: PrioritizationFee,
    transactionOptions?: TransactionOptions
): Promise<void> {
    const payer = signers[0];
    const adjustedPrioritizationFee =
        typeof prioritizationFee !== "undefined"
            ? addPrioritizationFeeInstruction(instructions, prioritizationFee)
            : new Decimal(0);

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

        try {
            signature = await connection.sendTransaction(transaction, {
                skipPreflight: transactionOptions?.skipPreflight ?? false,
                preflightCommitment: transactionOptions?.preflightCommitment ?? "confirmed",
                maxRetries: transactionOptions?.maxRetries,
                minContextSlot: transactionOptions?.minContextSlot,
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
                transactionOptions?.commitment ?? "confirmed"
            );
            if (confirmation.value.err === null) {
                latestErrorMessage = undefined;
                break;
            }
            throw new Error(JSON.stringify(confirmation.value.err, null, 4));
        } catch (err: unknown) {
            ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash());
            messageV0.recentBlockhash = blockhash;
            latestErrorMessage = err instanceof Error ? err.message : String(err);
            totalRetries++;

            logger.warn(
                "Transaction (%s) failed. Retry: %d/%d",
                signature ? formatPublicKey(signature, 8) : "?",
                totalRetries,
                envVars.MAX_TRANSACTION_CONFIRMATION_RETRIES
            );
        }
    } while (totalRetries < envVars.MAX_TRANSACTION_CONFIRMATION_RETRIES);

    if (latestErrorMessage) {
        throw new Error(latestErrorMessage);
    }

    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    logger.info(
        "Transaction (%s) confirmed: %s",
        formatPublicKey(signature!, 8),
        explorer.generateTransactionUri(signature!)
    );
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
}

function addPrioritizationFeeInstruction(
    instructions: TransactionInstruction[],
    prioritizationFee: PrioritizationFee
): Decimal {
    if (prioritizationFee.multiplierIndex >= envVars.PRIORITIZATION_FEE_MULTIPLIERS.length) {
        throw new Error(
            `Priroritization fee multiplier not found for index: ${prioritizationFee.multiplierIndex}`
        );
    }

    const prioritizationFeeMultiplier =
        envVars.PRIORITIZATION_FEE_MULTIPLIERS[prioritizationFee.multiplierIndex];

    const adjustedPrioritizationFee = new Decimal(prioritizationFee.amount)
        .mul(prioritizationFeeMultiplier)
        .round();
    if (adjustedPrioritizationFee.gt(0)) {
        instructions.unshift(
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: adjustedPrioritizationFee.toNumber(),
            })
        );
    }

    return adjustedPrioritizationFee;
}
