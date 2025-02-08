import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
    ComputeBudgetProgram,
    Keypair,
    LAMPORTS_PER_SOL,
    SendOptions,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, explorer, logger } from "../modules";
import { formatDecimal } from "./format";

export async function getWrapSolInstructions(
    amount: Decimal,
    owner: Keypair
): Promise<TransactionInstruction[]> {
    const associatedTokenAccount = getAssociatedTokenAddressSync(
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

    const lamports = amount.mul(LAMPORTS_PER_SOL);
    let residualLamports = new Decimal(0);
    if (wsolBalance.lt(lamports)) {
        residualLamports = lamports.sub(wsolBalance);
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: associatedTokenAccount,
                lamports: residualLamports.toNumber(),
            }),
            createSyncNativeInstruction(associatedTokenAccount, TOKEN_PROGRAM_ID)
        );
    }

    return instructions;
}

export async function sendAndConfirmVersionedTransaction(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    logMessage: string,
    prioritizationFee: number,
    sendOptions?: SendOptions
): Promise<void> {
    const adjustedPrioritizationFee = new Decimal(prioritizationFee).mul(
        envVars.PRIORITIZATION_FEE_MULTIPLIER
    );
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
