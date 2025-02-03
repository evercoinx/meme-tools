import {
    Keypair,
    LAMPORTS_PER_SOL,
    MessageV0,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddress,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    TokenAccountNotFoundError,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import { connection, explorer, logger } from "../modules";
import { formatDecimal } from "./format";

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

export async function wrapSol(amount: Decimal, owner: Keypair): Promise<void> {
    const associatedTokenAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        owner.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions: TransactionInstruction[] = [];
    let wsolBalance = new Decimal(0);

    try {
        const account = await getAccount(
            connection,
            associatedTokenAccount,
            "confirmed",
            TOKEN_PROGRAM_ID
        );
        wsolBalance = new Decimal(account.amount.toString(10));
    } catch (err) {
        if (!(err instanceof TokenAccountNotFoundError)) {
            throw err;
        }

        instructions.push(
            createAssociatedTokenAccountInstruction(
                owner.publicKey,
                associatedTokenAccount,
                owner.publicKey,
                NATIVE_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    const lamportsToWrap = amount.mul(LAMPORTS_PER_SOL).sub(wsolBalance);
    if (lamportsToWrap.gt(0)) {
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: associatedTokenAccount,
                lamports: lamportsToWrap.toNumber(),
            }),
            createSyncNativeInstruction(associatedTokenAccount, TOKEN_PROGRAM_ID)
        );
    }

    if (instructions.length === 0) {
        logger.warn(
            "Account %s has sufficient balance: %s WSOL. Skipping",
            owner.publicKey.toBase58(),
            formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL))
        );
        return;
    }

    await sendAndConfirmVersionedTransaction(
        instructions,
        [owner],
        `to wrap ${lamportsToWrap.div(LAMPORTS_PER_SOL).toNumber()} SOL for ${owner.publicKey.toBase58()}`
    );
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
