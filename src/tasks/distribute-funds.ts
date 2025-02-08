import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
    generateHolderKeypairs,
    importHolderKeypairs,
    importLocalKeypair,
} from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import { checkIfStorageExists } from "../helpers/validation";
import { connection, envVars, logger, prioritizationFees } from "../modules";

(async () => {
    try {
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const storageExists = await checkIfStorageExists(true);
        const holders = storageExists
            ? importHolderKeypairs(envVars.HOLDER_SHARE_POOL_PERCENTS.length)
            : generateHolderKeypairs(envVars.HOLDER_SHARE_POOL_PERCENTS.length);

        const amountsToWrap = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(percent)
        );

        await prioritizationFees.fetchFees();

        const sendDistrubuteSolTransaction = await distributeSol(
            amountsToWrap,
            new Decimal(envVars.HOLDER_COMPUTE_BUDGET_SOL),
            distributor,
            holders
        );
        const sendCreateWsolAssociatedTokenAccountsTransactions =
            await createWsolAssociatedTokenAccounts(holders);

        await Promise.all([sendDistrubuteSolTransaction]);
        await Promise.all(sendCreateWsolAssociatedTokenAccountsTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeSol(
    amountsToWrap: Decimal[],
    computeBudget: Decimal,
    distributor: Keypair,
    holders: Keypair[]
): Promise<Promise<void>> {
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
                    fromPubkey: distributor.publicKey,
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

        const wsolAssociatedTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        let wsolBalance = new Decimal(0);

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
                    fromPubkey: distributor.publicKey,
                    toPubkey: holder.publicKey,
                    lamports: residualLamportsToWrap.toNumber(),
                })
            );
        } else {
            logger.warn(
                "Holder %s has sufficient balance: %s WSOL",
                holder.publicKey.toBase58(),
                formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL))
            );
        }

        totalLamportsToDistribute = totalLamportsToDistribute
            .add(residualComputeBudgetLamports)
            .add(residualLamportsToWrap);
    }

    return instructions.length > 0
        ? sendAndConfirmVersionedTransaction(
              instructions,
              [distributor],
              `to distribute ${formatDecimal(totalLamportsToDistribute.div(LAMPORTS_PER_SOL))} SOL between holders`,
              prioritizationFees.averageFeeWithZeros
          )
        : Promise.resolve();
}

async function createWsolAssociatedTokenAccounts(holders: Keypair[]): Promise<Promise<void>[]> {
    const transactions: Promise<void>[] = [];

    for (const holder of holders) {
        const wsolAssociatedTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(
            wsolAssociatedTokenAccount,
            "confirmed"
        );
        if (wsolAccountInfo) {
            logger.warn(
                "Associated token account %s exists for holder %s",
                wsolAssociatedTokenAccount.toBase58(),
                holder.publicKey.toBase58()
            );
            continue;
        }

        transactions.push(
            sendAndConfirmVersionedTransaction(
                [
                    createAssociatedTokenAccountInstruction(
                        holder.publicKey,
                        wsolAssociatedTokenAccount,
                        holder.publicKey,
                        NATIVE_MINT,
                        TOKEN_PROGRAM_ID,
                        ASSOCIATED_TOKEN_PROGRAM_ID
                    ),
                ],
                [holder],
                `to create associated token account ${wsolAssociatedTokenAccount} for holder ${holder.publicKey.toBase58()}`,
                prioritizationFees.averageFeeWithZeros
            )
        );
    }

    return transactions;
}
