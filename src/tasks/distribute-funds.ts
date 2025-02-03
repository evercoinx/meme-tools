import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAssociatedTokenAddress,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { envVars, logger, storage, STORAGE_DIR } from "./init";
import { generateHolderKeypairs, importDevKeypair } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { decimal } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";

const HOLDER_COMPUTATION_BUDGET_SOL = 0.01;

(async () => {
    try {
        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);
        const holders = generateHolderKeypairs();

        const amount = new Decimal(envVars.INITIAL_POOL_SOL_LIQUIDITY).mul(
            envVars.HOLDER_SHARE_PERCENT_PER_POOL
        );
        await distributeSol(dev, holders, amount.plus(HOLDER_COMPUTATION_BUDGET_SOL));
        await wrapSol(holders, amount);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeSol(dev: Keypair, holders: Keypair[], amount: Decimal): Promise<void> {
    const instructions: TransactionInstruction[] = [];
    let totalAmount = new Decimal(0);

    for (const holder of holders) {
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: dev.publicKey,
                toPubkey: holder.publicKey,
                lamports: amount.mul(LAMPORTS_PER_SOL).toNumber(),
            })
        );
        totalAmount = totalAmount.add(amount);
    }

    await sendAndConfirmVersionedTransaction(
        instructions,
        [dev],
        `to distribute ${decimal.format(totalAmount.toNumber())} SOL between ${holders.length} holders`
    );
}

async function wrapSol(holders: Keypair[], amount: Decimal): Promise<void> {
    for (const holder of holders) {
        const instructions: TransactionInstruction[] = [];

        const associatedTokenAccount = await getAssociatedTokenAddress(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        instructions.push(
            createAssociatedTokenAccountInstruction(
                holder.publicKey,
                associatedTokenAccount,
                holder.publicKey,
                NATIVE_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            ),
            SystemProgram.transfer({
                fromPubkey: holder.publicKey,
                toPubkey: associatedTokenAccount,
                lamports: amount.mul(LAMPORTS_PER_SOL).toNumber(),
            }),
            createSyncNativeInstruction(associatedTokenAccount, TOKEN_PROGRAM_ID)
        );

        await sendAndConfirmVersionedTransaction(
            instructions,
            [holder],
            `to wrap ${decimal.format(amount.toNumber())} SOL for ${holder.publicKey.toBase58()}`
        );
    }
}
