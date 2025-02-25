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
import bs58 from "bs58";
import Decimal from "decimal.js";
import { PriorityLevel, UiTransactionEncoding } from "helius-sdk";
import { explorer, logger, TRANSACTION_CONFIRMATION_TIMEOUT_MS, ZERO_DECIMAL } from "../modules";
import { HeliusClient } from "../modules/helius";
import { formatDecimal, formatSignature } from "./format";

export interface TransactionOptions {
    skipPreflight?: boolean;
    preflightCommitment?: Commitment;
}

const TRANSACTION_POLL_TIMEOUT_MS = 15_000;
const TRANSACTION_POLL_INTERVAL_MS = 1_000;
const TRANSACTION_RESEND_ATTEMPTS = 5;
const DEFAULT_COMPUTE_UNIT_LIMIT = 220_000;

export type ContractErrors = Record<
    number,
    {
        instruction: string;
        code: string;
        message: string;
    }
>;

type InstructionError = [number, InstructionErrorDetails];

interface InstructionErrorDetails {
    Custom: number;
}

class FailedTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FailedTransactionError";
    }
}

class ResentTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResentTransactionError";
    }
}

export async function getComputeBudgetInstructions(
    connection: Connection,
    cluster: string,
    heliusClient: HeliusClient,
    priorityLevel: PriorityLevel,
    instructions: TransactionInstruction[],
    signers: Keypair[]
): Promise<TransactionInstruction[]> {
    const setComputeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
        units: DEFAULT_COMPUTE_UNIT_LIMIT,
    });

    const payer = signers[0];
    const transaction = await createTransaction(
        connection,
        [setComputeUnitLimitInstruction, ...instructions],
        payer
    );
    const priorityFee = await getPriorityFeeEstimate(
        cluster,
        heliusClient,
        transaction,
        priorityLevel
    );

    return [
        setComputeUnitLimitInstruction,
        ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee,
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
    cluster: string,
    heliusClient: HeliusClient,
    transaction: VersionedTransaction,
    priorityLevel: PriorityLevel
): Promise<number> {
    if (cluster === "devnet") {
        return [PriorityLevel.MIN, PriorityLevel.LOW].includes(priorityLevel) ? 0 : 10_000;
    }

    const serializedTransaction = transaction.serialize();
    const options =
        priorityLevel === PriorityLevel.DEFAULT ? { recommended: true } : { priorityLevel };

    const response = await heliusClient.getPriorityFeeEstimate({
        transaction: bs58.encode(serializedTransaction),
        options: { ...options, transactionEncoding: UiTransactionEncoding.Base58 },
    });

    return response.priorityFeeEstimate ?? 0;
}

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    transactionOptions?: TransactionOptions,
    resendErrors?: ContractErrors
): Promise<TransactionSignature | undefined> {
    let signature: TransactionSignature | undefined;

    const transaction = await createTransaction(connection, instructions, signers[0]);
    transaction.sign(signers);

    const startTime = Date.now();
    let resendAttempts = 0;

    do {
        try {
            signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: transactionOptions?.skipPreflight ?? false,
                preflightCommitment: transactionOptions?.preflightCommitment ?? "confirmed",
                maxRetries: 0,
            });
            logger.info("Transaction (%s) sent %s", formatSignature(signature), logMessage);

            return await pollTransactionConfirmation(connection, signature, resendErrors);
        } catch (error: unknown) {
            if (
                error instanceof ResentTransactionError &&
                resendAttempts < TRANSACTION_RESEND_ATTEMPTS
            ) {
                logger.error(
                    "Transaction (%s) resent: %s",
                    signature ? formatSignature(signature) : "?",
                    error.message
                );

                resendAttempts++;
                continue;
            }

            throw error;
        }
    } while (Date.now() - startTime < TRANSACTION_CONFIRMATION_TIMEOUT_MS);
}

async function pollTransactionConfirmation(
    connection: Connection,
    signature: TransactionSignature,
    resendErrors?: ContractErrors
): Promise<TransactionSignature> {
    let elapsed = 0;

    return new Promise<TransactionSignature>((resolve, reject) => {
        const intervalId = setInterval(async () => {
            elapsed += TRANSACTION_POLL_INTERVAL_MS;

            if (elapsed >= TRANSACTION_POLL_TIMEOUT_MS) {
                clearInterval(intervalId);
                reject(
                    new ResentTransactionError(
                        `Transaction (${formatSignature(signature)}) timed out after ${formatDecimal(elapsed / 1_000, 3)} sec`
                    )
                );
            }

            const status = await connection.getSignatureStatuses([signature]);
            const result = status?.value[0];
            if (result?.err) {
                clearInterval(intervalId);

                if (resendErrors) {
                    const errorDetails = parseRpcError(result.err);
                    if (errorDetails && resendErrors[errorDetails.Custom]) {
                        return reject(
                            new ResentTransactionError(
                                `Transaction (${formatSignature(signature)}) failed. Reason: ${resendErrors[errorDetails.Custom].message}`
                            )
                        );
                    }
                }

                return reject(
                    new FailedTransactionError(
                        `Transaction (${formatSignature(signature)}) failed: ${explorer.generateTransactionUri(signature)}. Reason: ${formatRpcError(result.err)}`
                    )
                );
            } else if (result?.confirmationStatus === "confirmed") {
                clearInterval(intervalId);

                logger.info(
                    "Transaction (%s) confirmed: %s",
                    formatSignature(signature),
                    explorer.generateTransactionUri(signature)
                );
                return resolve(signature);
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
            // Ignore Type error
        }
    }

    return String(error);
}
