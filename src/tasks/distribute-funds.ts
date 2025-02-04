import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, logger, storage, STORAGE_DIR } from "../modules";
import { generateHolderKeypairs, importDevKeypair, importHolderKeypairs } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
import { sendAndConfirmVersionedTransaction, wrapSol } from "../helpers/network";

(async () => {
    try {
        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);

        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        const holders = storageExists ? importHolderKeypairs() : generateHolderKeypairs();

        const amountToWrap = new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(
            envVars.HOLDER_SHARE_POOL_PERCENT
        );
        await distributeSol(
            amountToWrap,
            new Decimal(envVars.HOLDER_COMPUTE_BUDGET_SOL),
            dev,
            holders
        );

        for (const holder of holders) {
            await wrapSol(amountToWrap, holder);
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeSol(
    amountToWrap: Decimal,
    computeBudget: Decimal,
    dev: Keypair,
    holders: Keypair[]
): Promise<void> {
    const lamportsToWrap = amountToWrap.mul(LAMPORTS_PER_SOL);
    const computeBudgetLamports = computeBudget.mul(LAMPORTS_PER_SOL);
    const instructions: TransactionInstruction[] = [];
    let totalLamportsToDistribute = new Decimal(0);

    for (const holder of holders) {
        const solBalance = new Decimal(await connection.getBalance(holder.publicKey, "confirmed"));

        let residualComputeBudgetLamports = new Decimal(0);
        if (solBalance.lt(computeBudgetLamports)) {
            residualComputeBudgetLamports = residualComputeBudgetLamports =
                computeBudgetLamports.sub(solBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: dev.publicKey,
                    toPubkey: holder.publicKey,
                    lamports: residualComputeBudgetLamports.toNumber(),
                })
            );
        } else {
            logger.warn(
                "Account %s has sufficient balance: %s SOL. Skipping",
                holder.publicKey.toBase58(),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        }

        let wsolBalance = new Decimal(0);
        const wsolAssociatedTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        try {
            const wsolTokenAccountBalance = await connection.getTokenAccountBalance(
                wsolAssociatedTokenAccount,
                "confirmed"
            );
            wsolBalance = new Decimal(wsolTokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore Account not found error
        }

        let residualLamportsToWrap = new Decimal(0);
        if (wsolBalance.lt(lamportsToWrap)) {
            residualLamportsToWrap = lamportsToWrap.sub(wsolBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: dev.publicKey,
                    toPubkey: holder.publicKey,
                    lamports: residualLamportsToWrap.toNumber(),
                })
            );
        } else {
            logger.warn(
                "Account %s has sufficient balance: %s WSOL. Skipping",
                holder.publicKey.toBase58(),
                formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL))
            );
        }

        totalLamportsToDistribute = totalLamportsToDistribute
            .add(residualComputeBudgetLamports)
            .add(residualLamportsToWrap);
    }

    if (instructions.length > 0) {
        await sendAndConfirmVersionedTransaction(
            instructions,
            [dev],
            `to distribute ${formatDecimal(totalLamportsToDistribute.div(LAMPORTS_PER_SOL))} SOL between holders`
        );
    }
}
