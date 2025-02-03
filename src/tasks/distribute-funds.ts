import path from "node:path";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, logger, storage, STORAGE_DIR } from "../modules";
import { generateHolderKeypairs, importDevKeypair, importHolderKeypairs } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
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
    const lamports = amount.mul(LAMPORTS_PER_SOL);
    const instructions: TransactionInstruction[] = [];
    let totalLamportsToDistribute = new Decimal(0);

    for (const holder of holders) {
        const balance = new Decimal(await connection.getBalance(holder.publicKey, "confirmed"));
        if (balance.gte(lamports)) {
            logger.warn(
                "Account %s has sufficient balance: %s SOL. Skipping",
                holder.publicKey.toBase58(),
                formatDecimal(balance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        const lamportsToDistribute = lamports.sub(balance);
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: dev.publicKey,
                toPubkey: holder.publicKey,
                lamports: lamportsToDistribute.toNumber(),
            })
        );
        totalLamportsToDistribute = totalLamportsToDistribute.add(lamportsToDistribute);
    }

    if (instructions.length > 0) {
        await sendAndConfirmVersionedTransaction(
            instructions,
            [dev],
            `to distribute ${formatDecimal(totalLamportsToDistribute.div(LAMPORTS_PER_SOL))} SOL between holders`
        );
    }
}
