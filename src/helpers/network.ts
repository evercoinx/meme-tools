import {
    Commitment,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import axios, { AxiosResponse } from "axios";
import bs58 from "bs58";
import { CLUSTER, explorer, logger } from "../modules";
import {
    GetPriorityFeeEstimateRequest,
    GetPriorityFeeEstimateResponse,
    HeliusClient,
    PriorityLevel,
} from "../modules/helius";
import { formatPublicKey, formatSignature } from "./format";

export interface TransactionOptions {
    skipPreflight?: boolean;
    preflightCommitment?: Commitment;
    commitment?: Commitment;
}

const MAX_TRANSACTION_CONFIRMATION_RETRIES = 5;

export async function getComputeUnitPriceInstruction(
    connection: Connection,
    heliusClient: HeliusClient,
    priorityLevel: PriorityLevel,
    instructions: TransactionInstruction[],
    payer: Keypair
) {
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        instructions,
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
    });
    const transaction = new VersionedTransaction(messageV0.compileToV0Message());

    const priorityFeeEstimate = await getPriorityFeeEstimate(
        heliusClient,
        priorityLevel,
        transaction
    );
    return ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeEstimate,
    });
}

async function getPriorityFeeEstimate(
    heliusClient: HeliusClient,
    priorityLevel: PriorityLevel,
    transaction: VersionedTransaction
): Promise<number> {
    if (CLUSTER === "devnet") {
        return ["Min", "Low"].includes(priorityLevel) ? 0 : 10_000;
    }

    let response: AxiosResponse<GetPriorityFeeEstimateResponse> | undefined;
    const serializedTransaction = transaction.serialize();
    const options = priorityLevel === "Default" ? { recommended: true } : { priorityLevel };

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
                    options,
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

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
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
            const transaction = new VersionedTransaction(messageV0.compileToV0Message());
            transaction.sign(signers);

            signature = await connection.sendTransaction(transaction, {
                skipPreflight: transactionOptions?.skipPreflight ?? false,
                preflightCommitment: transactionOptions?.preflightCommitment ?? "confirmed",
                maxRetries: 0,
            });

            logger.info("Transaction (%s) sent %s", formatSignature(signature), logMessage);

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
                MAX_TRANSACTION_CONFIRMATION_RETRIES
            );
        }
    } while (totalRetries < MAX_TRANSACTION_CONFIRMATION_RETRIES);

    if (latestErrorMessage) {
        throw new Error(latestErrorMessage);
    }

    logger.info(
        "Transaction (%s) confirmed: %s",
        signature ? formatPublicKey(signature, 8) : "?",
        signature ? explorer.generateTransactionUri(signature) : "?"
    );
}
