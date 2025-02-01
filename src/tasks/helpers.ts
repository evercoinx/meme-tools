import fs from "node:fs/promises";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    MessageV0,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Logger } from "pino";

export function formatSol(amount: BN | bigint | number, decimals = 3) {
    return new Decimal(amount.toString(10)).div(LAMPORTS_PER_SOL).toFixed(decimals);
}

export function formatUnits(amount: BN | bigint | number, units: number, decimals = 0) {
    return new Decimal(amount.toString(10)).div(units).toFixed(decimals);
}

export function versionedMessageToInstructions(
    versionedMessage: MessageV0
): TransactionInstruction[] {
    const accountKeys = versionedMessage.staticAccountKeys;
    const instructions: TransactionInstruction[] = [];

    for (const compiledIx of versionedMessage.compiledInstructions) {
        const keys = compiledIx.accountKeyIndexes.map((index) => ({
            pubkey: accountKeys[index],
            isSigner: versionedMessage.isAccountSigner(index),
            isWritable: versionedMessage.isAccountWritable(index),
        }));
        const programId = accountKeys[compiledIx.programIdIndex];
        const data = Buffer.from(compiledIx.data);

        instructions.push(
            new TransactionInstruction({
                keys,
                programId,
                data,
            })
        );
    }

    return instructions;
}

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

export async function checkIfFileExists(path: string) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
