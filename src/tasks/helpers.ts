import fs from "node:fs/promises";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { Logger } from "pino";

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
    cluster: string,
    instructions: TransactionInstruction[],
    signers: Keypair[],
    explorerUri: string,
    logger: Logger,
    logMessage: string
): Promise<void> {
    const payer = signers[0];

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign(signers);

    logger.debug(`Sending transaction ${logMessage}...`);
    const signature = await connection.sendTransaction(transaction, {
        preflightCommitment: "confirmed",
    });

    const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
    });
    if (confirmation.value.err !== null) {
        throw new Error(confirmation.value.err.toString());
    }

    logger.info(`Transaction ${logMessage} confirmed`);
    logger.info(`${explorerUri}/tx/${signature}?cluster=${cluster}-alpha`);
}

export function lamportsToSol(lamports: bigint | number, decimals = 3) {
    const sol = new Decimal(lamports.toString()).div(LAMPORTS_PER_SOL);
    return sol.toFixed(decimals);
}

export async function checkIfFileExists(path: string) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
