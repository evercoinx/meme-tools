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
import {
    connection,
    encryption,
    envVars,
    logger,
    storage,
    STORAGE_DIR,
    STORAGE_HOLDER_SECRET_KEYS,
} from "./init";
import { checkIfFileExists } from "../helpers/filesystem";
import { decimal } from "../helpers/format";
import { importDevKeypair, sendAndConfirmVersionedTransaction } from "../helpers/network";

const HOLDER_COMPUTATION_BUDGET_SOL = 0.01;

(async () => {
    try {
        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const dev = await importDevKeypair(
            envVars.DEV_KEYPAIR_PATH,
            connection,
            envVars.CLUSTER,
            logger
        );
        const holders = generateOrImportHolderKeypairs();

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

function generateOrImportHolderKeypairs(): Keypair[] {
    const holders: Keypair[] = [];

    for (let i = 0; i < envVars.HOLDER_COUNT_PER_POOL; i++) {
        const holder = Keypair.generate();
        holders.push(holder);
        logger.info("Holder %d generated: %s", i, holder.publicKey.toBase58());

        const encryptedHolder = encryption.encrypt(JSON.stringify(Array.from(holder.secretKey)));
        storage.set(STORAGE_HOLDER_SECRET_KEYS[i], encryptedHolder);
        storage.save();
        logger.debug("Holder %d saved to storage as encrypted", i);
    }

    return holders;
}

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
        connection,
        instructions,
        [dev],
        logger,
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
            connection,
            instructions,
            [holder],
            logger,
            `to wrap ${decimal.format(amount.toNumber())} SOL for ${holder.publicKey.toBase58()}`
        );
    }
}
