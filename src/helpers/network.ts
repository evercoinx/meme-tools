import {
    Commitment,
    ComputeBudgetProgram,
    Keypair,
    SendOptions,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { CLUSTER, connection, envVars, explorer, logger } from "../modules";
import { formatDecimal, formatPublicKey, formatSignature } from "./format";

type PriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax" | "Default";

interface GetPriorityFeeEstimateResponse {
    id?: string;
    jsonrpc: string;
    result?: {
        priorityFeeEstimate: number;
    };
    error?: {
        code: number;
        message: string;
    };
}

interface TransactionOptions extends SendOptions {
    commitment?: Commitment;
}

async function getPriorityFeeEstimate(
    priorityLevel: PriorityLevel,
    transaction: VersionedTransaction
): Promise<number> {
    if (CLUSTER === "devnet") {
        return 0;
    }

    const response = await fetch(envVars.RPC_URI, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            method: "getPriorityFeeEstimate",
            params: [
                {
                    transaction: bs58.encode(transaction.serialize()),
                    options: {
                        priorityLevel,
                    },
                },
            ],
        }),
    });

    const jsonResponse = (await response.json()) as GetPriorityFeeEstimateResponse;
    if (!response.ok && jsonResponse.error) {
        throw new Error(
            `RPC Method: getPriorityFeeEstimate. Code: ${jsonResponse.error.code}. Message: ${jsonResponse.error.message}`
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return jsonResponse.result!.priorityFeeEstimate;
}

export async function sendAndConfirmVersionedTransaction(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    priorityLevel: PriorityLevel,
    transactionOptions?: TransactionOptions
): Promise<void> {
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
        try {
            let transaction = new VersionedTransaction(messageV0.compileToV0Message());

            const priorityFeeEstimate = await getPriorityFeeEstimate(priorityLevel, transaction);
            if (priorityFeeEstimate > 0) {
                messageV0.instructions = [
                    ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: priorityFeeEstimate,
                    }),
                    ...instructions,
                ];
                transaction = new VersionedTransaction(messageV0.compileToV0Message());
            }

            transaction.sign(signers);
            signature = await connection.sendTransaction(transaction, {
                skipPreflight: transactionOptions?.skipPreflight ?? false,
                preflightCommitment: transactionOptions?.preflightCommitment ?? "confirmed",
                maxRetries: transactionOptions?.maxRetries,
                minContextSlot: transactionOptions?.minContextSlot,
            });

            logger.info(
                "Transaction (%s) sent %s. Priority fee: %s microlamports",
                formatSignature(signature),
                logMessage,
                formatDecimal(priorityFeeEstimate, 0)
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
