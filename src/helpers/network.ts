import fs from "node:fs/promises";
import {
    Cluster,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    MessageV0,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { Logger } from "pino";
import { formatSol } from "./format";
import { explorer } from "../tasks/init";

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

export async function importDevKeypair(
    keypairPath: string,
    connection: Connection,
    cluster: Cluster,
    logger: Logger
): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(keypairPath, "utf8"));
    const dev = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    if (cluster === "devnet") {
        const balance = await connection.getBalance(dev.publicKey);
        if (balance === 0) {
            const amount = 2 * LAMPORTS_PER_SOL;
            await connection.requestAirdrop(dev.publicKey, amount);
            logger.debug(`Payer balance topped up: ${formatSol(amount)} SOL`);
        }
    }

    logger.info(`Dev imported: ${dev.publicKey.toBase58()}`);

    return dev;
}

export async function sendAndConfirmVersionedTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Keypair[],
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

    logger.debug(`Sending transaction ${logMessage}`);
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

    logger.info("Transaction confirmed: %s", explorer.generateTransactionUri(signature));
}
