import path from "node:path";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, logger, storage, STORAGE_DIR } from "../modules";
import { generateHolderKeypairs, importDevKeypair, importHolderKeypairs } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { decimal } from "../helpers/format";
import { sendAndConfirmVersionedTransaction, wrapSol } from "../helpers/network";

const HOLDER_COMPUTATION_BUDGET_SOL = 0.01;

(async () => {
    try {
        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);

        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        const holders = storageExists ? importHolderKeypairs() : generateHolderKeypairs();

        const amount = new Decimal(envVars.INITIAL_POOL_SOL_LIQUIDITY).mul(
            envVars.HOLDER_SHARE_PERCENT_PER_POOL
        );
        await distributeSol(amount.plus(HOLDER_COMPUTATION_BUDGET_SOL), dev, holders);

        for (const holder of holders) {
            await wrapSol(amount, holder);
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeSol(amount: Decimal, dev: Keypair, holders: Keypair[]): Promise<void> {
    const instructions: TransactionInstruction[] = [];
    let totalAmount = new Decimal(0);

    for (const holder of holders) {
        const balance = await connection.getBalance(holder.publicKey, "confirmed");
        if (balance > 0) {
            logger.warn("Holder %s has non zero balance. Skipped", holder.publicKey.toBase58());
            continue;
        }

        instructions.push(
            SystemProgram.transfer({
                fromPubkey: dev.publicKey,
                toPubkey: holder.publicKey,
                lamports: amount.mul(LAMPORTS_PER_SOL).toNumber(),
            })
        );
        totalAmount = totalAmount.add(amount);
    }

    if (instructions.length > 0) {
        await sendAndConfirmVersionedTransaction(
            instructions,
            [dev],
            `to distribute ${decimal.format(totalAmount.toNumber())} SOL between holders`
        );
    }
}
