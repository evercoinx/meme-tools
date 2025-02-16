import {
    Commitment,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    TransactionInstruction,
    TransactionMessage,
    TransactionSignature,
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
import { formatSignature } from "./format";

export interface TransactionOptions {
    skipPreflight?: boolean;
    preflightCommitment?: Commitment;
    commitment?: Commitment;
}

const TRANSACTION_TTL_MS = 60_000;
const TRANSACTION_POLL_TIMEOUT_MS = 15_000;
const TRANSACTION_POLL_INTERVAL_MS = 1_000;
const DEFAULT_COMPUTE_UNIT_LIMIT = 220_000;

export async function getComputeBudgetInstructions(
    connection: Connection,
    heliusClient: HeliusClient,
    priorityLevel: PriorityLevel,
    instructions: TransactionInstruction[],
    payer: Keypair
): Promise<TransactionInstruction[]> {
    const setComputeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
        units: DEFAULT_COMPUTE_UNIT_LIMIT,
    });
    const transaction = await createTransaction(
        connection,
        [setComputeUnitLimitInstruction, ...instructions],
        payer
    );

    const priorityFeeEstimate = await getPriorityFeeEstimate(
        heliusClient,
        priorityLevel,
        transaction
    );

    return [
        setComputeUnitLimitInstruction,
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeEstimate }),
    ];
}

async function createTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    payer: Keypair
): Promise<VersionedTransaction> {
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        instructions,
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
    });

    return new VersionedTransaction(messageV0.compileToV0Message());
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
): Promise<TransactionSignature | undefined> {
    let signature: TransactionSignature | undefined;

    const transaction = await createTransaction(connection, instructions, signers[0]);
    transaction.sign(signers);

    const startTime = Date.now();
    let errorMessage: string | undefined;

    do {
        try {
            signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: transactionOptions?.skipPreflight ?? false,
                preflightCommitment: transactionOptions?.preflightCommitment ?? "confirmed",
                maxRetries: 0,
            });
            logger.info("Transaction (%s) sent %s", formatSignature(signature), logMessage);

            return await pollTransactionConfirmation(connection, signature);
        } catch (error: unknown) {
            errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
                "Resending failed transaction (%s). Reason: %s",
                signature ? formatSignature(signature) : "?",
                errorMessage
            );
            continue;
        }
    } while (Date.now() - startTime < TRANSACTION_TTL_MS);

    throw new Error(errorMessage);
}

async function pollTransactionConfirmation(
    connection: Connection,
    signature: TransactionSignature
): Promise<TransactionSignature> {
    let elapsed = 0;

    return new Promise<TransactionSignature>((resolve, reject) => {
        const intervalId = setInterval(async () => {
            elapsed += TRANSACTION_POLL_INTERVAL_MS;

            if (elapsed >= TRANSACTION_POLL_TIMEOUT_MS) {
                clearInterval(intervalId);
                reject(
                    new Error(
                        `Transaction (${formatSignature(signature)}) timed out. Elapsed: ${elapsed / 1_000} sec`
                    )
                );
            }

            const status = await connection.getSignatureStatuses([signature]);
            if (status?.value[0]?.confirmationStatus === "confirmed") {
                clearInterval(intervalId);
                logger.info(
                    "Transaction (%s) confirmed: %s",
                    formatSignature(signature),
                    explorer.generateTransactionUri(signature)
                );

                resolve(signature);
            }
        }, TRANSACTION_POLL_INTERVAL_MS);
    });
}
