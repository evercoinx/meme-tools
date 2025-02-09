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
import { formatDecimal } from "./format";

interface TransactionOptions extends SendOptions {
    commitment: Commitment;
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

    logger.info(
        "Sending transaction %s. Prioritization fee: %s microlamports",
        logMessage,
        formatDecimal(adjustedPrioritizationFee, 0)
    );

    const payer = signers[0];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign(signers);

    const signature = await connection.sendTransaction(transaction, {
        skipPreflight: options?.skipPreflight ?? false,
        preflightCommitment: options?.preflightCommitment ?? "confirmed",
        maxRetries: options?.maxRetries,
        minContextSlot: options?.minContextSlot,
    });

    const confirmation = await connection.confirmTransaction(
        {
            signature,
            blockhash,
            lastValidBlockHeight,
        },
        options?.commitment ?? "confirmed"
    );
    if (confirmation.value.err !== null) {
        throw new Error(JSON.stringify(confirmation.value.err, null, 4));
    }

    logger.info("Transaction confirmed: %s", explorer.generateTransactionUri(signature));
}
