import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { connection, envVars, logger } from "../modules";
import { generateHolderKeypairs, importDevKeypair, importHolderKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
import { getWrapSolInsturctions, sendAndConfirmVersionedTransaction } from "../helpers/network";

(async () => {
    try {
        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);

        const storageExists = await checkIfStorageExists(true);
        const holders = storageExists ? importHolderKeypairs() : generateHolderKeypairs();

        const amountsToWrap = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(percent)
        );
        if (holders.length !== amountsToWrap.length) {
            throw new Error(
                `Holders count and their shares mismatch: ${holders.length} != ${amountsToWrap.length}`
            );
        }

        await distributeSol(
            amountsToWrap,
            new Decimal(envVars.HOLDER_COMPUTE_BUDGET_SOL),
            dev,
            holders
        );

        await wrapSol(amountsToWrap, holders);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeSol(
    amountsToWrap: Decimal[],
    computeBudget: Decimal,
    dev: Keypair,
    holders: Keypair[]
): Promise<void> {
    const computeBudgetLamports = computeBudget.mul(LAMPORTS_PER_SOL);
    const instructions: TransactionInstruction[] = [];
    let totalLamportsToDistribute = new Decimal(0);

    for (const [i, holder] of holders.entries()) {
        const lamportsToWrap = amountsToWrap[i].mul(LAMPORTS_PER_SOL);

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
                "Holder %s has sufficient balance: %s SOL. Skipping",
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
            // Ignore TokenAccountNotFoundError error
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
                "Holder %s has sufficient balance: %s WSOL. Skipping",
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

async function wrapSol(amountsToWrap: Decimal[], holders: Keypair[]): Promise<void> {
    const transactions: Promise<void>[] = [];
    for (const [i, holder] of holders.entries()) {
        const [instructions, lamportsToWrap] = await getWrapSolInsturctions(
            amountsToWrap[i],
            holder
        );
        if (instructions.length > 0) {
            transactions.push(
                sendAndConfirmVersionedTransaction(
                    instructions,
                    [holder],
                    `to wrap ${formatDecimal(lamportsToWrap.div(LAMPORTS_PER_SOL))} SOL for ${holder.publicKey.toBase58()}`
                )
            );
        }
    }

    await Promise.all(transactions);
}
