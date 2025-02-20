import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Commitment,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    SystemProgram,
    TransactionError,
    TransactionInstruction,
    TransactionMessage,
    TransactionSignature,
    VersionedTransaction,
} from "@solana/web3.js";
import axios, { AxiosResponse } from "axios";
import bs58 from "bs58";
import Decimal from "decimal.js";
import {
    CLUSTER,
    explorer,
    logger,
    TRANSACTION_CONFIRMATION_TIMEOUT_MS,
    ZERO_DECIMAL,
} from "../modules";
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
}

const TRANSACTION_POLL_TIMEOUT_MS = 15_000;
const TRANSACTION_POLL_INTERVAL_MS = 1_000;
const DEFAULT_COMPUTE_UNIT_LIMIT = 220_000;

type InstructionError = [number, InstructionErrorDetails];

interface InstructionErrorDetails {
    Custom: number;
}

class ReplayedTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReplayedTransactionError";
    }
}

class FailedTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FailedTransactionError";
    }
}

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
        ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFeeEstimate,
        }),
    ];
}

export async function getWrapSolInstructions(
    connection: Connection,
    account: Keypair,
    payer: Keypair,
    lamports: Decimal
): Promise<TransactionInstruction[]> {
    const tokenAccount = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        account.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions: TransactionInstruction[] = [];
    let wsolBalance = ZERO_DECIMAL;

    try {
        const account = await getAccount(connection, tokenAccount, "confirmed", TOKEN_PROGRAM_ID);
        wsolBalance = new Decimal(account.amount.toString(10));
    } catch {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                tokenAccount,
                account.publicKey,
                NATIVE_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    if (wsolBalance.lt(lamports)) {
        const residualLamports = lamports.sub(wsolBalance);
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: tokenAccount,
                lamports: residualLamports.trunc().toNumber(),
            }),
            createSyncNativeInstruction(tokenAccount, TOKEN_PROGRAM_ID)
        );
    }

    return instructions;
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
            if (error instanceof ReplayedTransactionError) {
                logger.error(
                    "Transaction (%s) replayed: %s",
                    signature ? formatSignature(signature) : "?",
                    error.message
                );
                continue;
            }

            throw error;
        }
    } while (Date.now() - startTime < TRANSACTION_CONFIRMATION_TIMEOUT_MS);
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
                    new ReplayedTransactionError(
                        `Transaction (${formatSignature(signature)}) timed out`
                    )
                );
            }

            const status = await connection.getSignatureStatuses([signature]);
            const result = status?.value[0];
            if (result?.err) {
                clearInterval(intervalId);

                const errorDetails = parseRpcError(result.err);
                if (errorDetails !== null && errorDetails.Custom === 6_000) {
                    reject(
                        new ReplayedTransactionError(
                            `Transaction (${formatSignature(signature)}) failed. Reason: Insufficient pool liquidity or invalid swap`
                        )
                    );
                } else {
                    reject(
                        new FailedTransactionError(
                            `Transaction (${formatSignature(signature)}) failed: ${explorer.generateTransactionUri(signature)}. Reason: ${formatRpcError(result.err)}`
                        )
                    );
                }
            } else if (result?.confirmationStatus === "confirmed") {
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

function parseRpcError(error: TransactionError | null): InstructionErrorDetails | null {
    if (typeof error === "object" && error !== null && "InstructionError" in error) {
        const [, errorDetails] = error.InstructionError as InstructionError;
        return errorDetails;
    }

    return null;
}

function formatRpcError(error: TransactionError | null): string {
    if (error === null) {
        return "Unknown error";
    }

    if (typeof error === "object") {
        if ("InstructionError" in error) {
            const [instructionIndex, errorDetails] = error.InstructionError as InstructionError;
            return `Error processing Instruction ${instructionIndex}. Details: ${JSON.stringify(errorDetails)}`;
        }

        try {
            return JSON.stringify(error);
        } catch {
            // Ignore JSON error
        }
    }

    return String(error);
}
