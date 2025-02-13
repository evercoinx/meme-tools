import {
    Commitment,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    SendOptions,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import axios, { AxiosResponse } from "axios";
import bs58 from "bs58";
import { CLUSTER, envVars, explorer, heliusClient, logger } from "../modules";
import {
    GetPriorityFeeEstimateRequest,
    GetPriorityFeeEstimateResponse,
    PriorityLevel,
} from "../modules/helius";
import { formatDecimal, formatPublicKey, formatSignature } from "./format";

export interface TransactionOptions extends SendOptions {
    commitment?: Commitment;
}

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
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

    logger.info(
        "Transaction (%s) confirmed: %s",
        signature ? formatPublicKey(signature, 8) : "?",
        signature ? explorer.generateTransactionUri(signature) : "?"
    );
}

async function getPriorityFeeEstimate(
    priorityLevel: PriorityLevel,
    transaction: VersionedTransaction
): Promise<number> {
    if (CLUSTER === "devnet") {
        return ["Min", "Low"].includes(priorityLevel) ? 0 : 10_000;
    }

    let response: AxiosResponse<GetPriorityFeeEstimateResponse> | undefined;
    const serializedTransaction = transaction.serialize();

    try {
        response = await heliusClient.post<
            GetPriorityFeeEstimateResponse,
            AxiosResponse<GetPriorityFeeEstimateResponse>,
            GetPriorityFeeEstimateRequest
        >("/", {
            jsonrpc: "2.0",
            id: Buffer.from(serializedTransaction).toString("hex"),
            method: "getPriorityFeeEstimate",
            params: [
                {
                    transaction: bs58.encode(serializedTransaction),
                    options: { priorityLevel },
                },
            ],
        });
    } catch (err) {
        if (axios.isAxiosError<GetPriorityFeeEstimateResponse>(err) && err.response?.data.error) {
            const {
                response: { data },
            } = err;

            throw new Error(
                `Failed to call getPriorityFeeEstimate. Code: ${data.error?.code ?? "?"}. Message: ${data.error?.message ?? "?"}`
            );
        }

        throw new Error(`Failed to call getPriorityFeeEstimate: ${err}`);
    }

    return response.data.result?.priorityFeeEstimate ?? 0;
}
