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
    LAMPORTS_PER_SOL,
    Signer,
    SystemProgram,
    TransactionError,
    TransactionInstruction,
    TransactionMessage,
    TransactionSignature,
    VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import Decimal from "decimal.js";
import { GetPriorityFeeEstimateResponse, PriorityLevel, UiTransactionEncoding } from "helius-sdk";
import { explorer, logger, TRANSACTION_CONFIRMATION_TIMEOUT_MS, ZERO_DECIMAL } from "../modules";
import { RPC_CLUSTER } from "../modules/environment";
import { HeliusClient } from "../modules/helius";
import {
    capitalize,
    formatDecimal,
    formatInteger,
    formatMilliseconds,
    formatSignature,
} from "./format";

export interface TransactionOptions {
    skipPreflight?: boolean;
    preflightCommitment?: Commitment;
}

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

const TRANSACTION_POLL_TIMEOUT_MS = 15_000;
const TRANSACTION_POLL_INTERVAL_MS = TRANSACTION_POLL_TIMEOUT_MS / 10;
const TRANSACTION_RESEND_ATTEMPTS = 3;
const RECOMMENDED_COMPUTE_UNIT_PRICE = 10_000;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MIN_COMPUTE_UNIT_LIMIT = 1_000;
const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;
const COMPUTE_UNIT_LIMIT_MULTIPLIER = 1.2;

export async function getComputeBudgetInstructions(
    connection: Connection,
    cluster: RPC_CLUSTER,
    heliusClient: HeliusClient,
    priorityLevel: PriorityLevel,
    instructions: TransactionInstruction[],
    signers: Keypair[]
): Promise<TransactionInstruction[]> {
    const sendGetcomputeUnitPrice = getComputeUnitPrice(
        connection,
        cluster,
        heliusClient,
        instructions,
        signers,
        priorityLevel
    );
    const sendComputeUnitLimit = getComputeUnitLimit(connection, instructions, signers);

    const [computeUnitPrice, computeUnitLimit] = await Promise.all([
        sendGetcomputeUnitPrice,
        sendComputeUnitLimit,
    ]);

    return [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
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
    signers: Signer[]
): Promise<VersionedTransaction> {
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        instructions,
        payerKey: signers[0].publicKey,
        recentBlockhash: blockhash,
    });

    const transaction = new VersionedTransaction(messageV0.compileToV0Message());
    transaction.sign(signers);

    return transaction;
}

async function getComputeUnitPrice(
    connection: Connection,
    cluster: RPC_CLUSTER,
    heliusClient: HeliusClient,
    instructions: TransactionInstruction[],
    signers: Signer[],
    priorityLevel: PriorityLevel
): Promise<number> {
    if (cluster === "devnet") {
        return [PriorityLevel.MIN, PriorityLevel.LOW].includes(priorityLevel)
            ? 0
            : RECOMMENDED_COMPUTE_UNIT_PRICE;
    }

    const transaction = await createTransaction(connection, instructions, signers);
    const options =
        priorityLevel === PriorityLevel.DEFAULT ? { recommended: true } : { priorityLevel };

    let response: GetPriorityFeeEstimateResponse | undefined;
    try {
        response = await heliusClient.getPriorityFeeEstimate({
            transaction: bs58.encode(transaction.serialize()),
            options: {
                ...options,
                transactionEncoding: UiTransactionEncoding.Base58,
            },
        });
    } catch (error: unknown) {
        logger.warn(
            "%s. Compute unit price defaults to %s SOL",
            error instanceof Error ? error.message : String(error),
            formatDecimal(new Decimal(RECOMMENDED_COMPUTE_UNIT_PRICE).div(LAMPORTS_PER_SOL))
        );
        return RECOMMENDED_COMPUTE_UNIT_PRICE;
    }

    return response.priorityFeeEstimate ?? RECOMMENDED_COMPUTE_UNIT_PRICE;
}

async function getComputeUnitLimit(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[]
): Promise<number> {
    const transaction = await createTransaction(
        connection,
        [
            ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNIT_LIMIT }),
            ...instructions,
        ],
        signers
    );

    let unitsConsumed: number | undefined;
    let rpcError: TransactionError | null;

    try {
        ({
            value: { unitsConsumed, err: rpcError },
        } = await connection.simulateTransaction(transaction, { sigVerify: signers.length > 0 }));
    } catch (error: unknown) {
        logger.warn(
            "%s. Compute unit limit defaults to %s",
            capitalize(error instanceof Error ? error.message : String(error)),
            formatInteger(DEFAULT_COMPUTE_UNIT_LIMIT)
        );
        return DEFAULT_COMPUTE_UNIT_LIMIT;
    }

    if (rpcError || !unitsConsumed) {
        logger.warn(
            "Simulation failed: %s. Compute unit limit defaults to %s",
            formatRpcError(rpcError),
            formatInteger(DEFAULT_COMPUTE_UNIT_LIMIT)
        );
        return DEFAULT_COMPUTE_UNIT_LIMIT;
    }

    if (unitsConsumed < MIN_COMPUTE_UNIT_LIMIT) {
        unitsConsumed = MIN_COMPUTE_UNIT_LIMIT;
    }

    return new Decimal(unitsConsumed).mul(COMPUTE_UNIT_LIMIT_MULTIPLIER).trunc().toNumber();
}

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[],
    logMessage: string,
    transactionOptions?: TransactionOptions
): Promise<TransactionSignature | undefined> {
    if (!signers.length) {
        throw new Error("Transaction must have at least one signer");
    }

    const computeBudgetInstructions = instructions.filter((instruction) =>
        instruction.programId.equals(ComputeBudgetProgram.programId)
    );
    if (computeBudgetInstructions.length < 2) {
        throw new Error("Transaction must have instructions setting compute unit price and limit");
    }

    const transaction = await createTransaction(connection, instructions, signers);

    let signature: TransactionSignature | undefined;
    let resendAttempts = 0;
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
    signature: TransactionSignature
): Promise<TransactionSignature> {
    let elapsed = 0;

    return new Promise<TransactionSignature>((resolve, reject) => {
        const intervalId = setInterval(async () => {
            elapsed += TRANSACTION_POLL_INTERVAL_MS;

            if (elapsed >= TRANSACTION_POLL_TIMEOUT_MS) {
                clearInterval(intervalId);
                reject(
                    new ResentTransactionError(
                        `Transaction (${signature}) failed: Timeout after ${formatMilliseconds(elapsed)} sec`
                    )
                );
            }

            const status = await connection.getSignatureStatuses([signature]);
            const result = status?.value[0];
            if (result?.err) {
                clearInterval(intervalId);

                return reject(
                    new FailedTransactionError(
                        `Transaction (${signature}) failed: ${explorer.generateTransactionUri(signature)}. Reason: ${formatRpcError(result.err)}`
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
