import {
    Keypair,
    MessageV0,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { connection, explorer, logger } from "../tasks/init";

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
    instructions: TransactionInstruction[],
    signers: Keypair[],
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
