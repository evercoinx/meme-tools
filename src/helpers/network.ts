import {
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

export async function sendAndConfirmVersionedTransaction(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    prioritizationFee: number,
    sendOptions?: SendOptions
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

    const signature = await connection.sendTransaction(
        transaction,
        sendOptions ?? {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        }
    );

    const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
    });
    if (confirmation.value.err !== null) {
        throw new Error(JSON.stringify(confirmation.value.err, null, 4));
    }

    logger.info("Transaction confirmed: %s", explorer.generateTransactionUri(signature));
}
