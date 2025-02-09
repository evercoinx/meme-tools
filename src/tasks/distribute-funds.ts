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
import { formatDecimal, formatPublicKey } from "../helpers/format";
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

        const amountsToDistribute = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL)
                .mul(percent)
                .plus(envVars.HOLDER_COMPUTE_BUDGET_SOL)
        );

        await prioritizationFees.fetchFees();
        const sendDistrubuteFundsTransaction = await distributeFunds(
            amountsToDistribute,
            distributor,
            holders
        );
        await Promise.all([sendDistrubuteFundsTransaction]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeFunds(
    amountsToDistribute: Decimal[],
    distributor: Keypair,
    holders: Keypair[]
): Promise<Promise<void>> {
    const instructions: TransactionInstruction[] = [];

    for (const [i, holder] of holders.entries()) {
        const lamports = amountsToDistribute[i].mul(LAMPORTS_PER_SOL);
        const solBalance = new Decimal(await connection.getBalance(holder.publicKey, "confirmed"));

        if (solBalance.gte(lamports)) {
            logger.warn(
                "Holder #%d (%s) has sufficient balance: %s SOL",
                i,
                formatPublicKey(holder.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            const residualLamports = lamports.sub(solBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: holder.publicKey,
                    lamports: residualLamports.toNumber(),
                })
            );
        }

        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
        if (wsolAccountInfo) {
            logger.warn(
                "WSOL ATA (%s) exists for holder #%d (%s)",
                wsolTokenAccount.toBase58(),
                i,
                holder.publicKey.toBase58()
            );
        } else {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    distributor.publicKey,
                    wsolTokenAccount,
                    holder.publicKey,
                    NATIVE_MINT,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )
            );
        }
    }

    return instructions.length > 0
        ? sendAndConfirmVersionedTransaction(
              instructions,
              [distributor],
              `to distribute funds from distributor (${formatPublicKey(distributor.publicKey)}) to ${holders.length} holders`,
              {
                  amount: prioritizationFees.averageFeeWithZeros,
                  multiplierIndex: 0,
              }
          )
        : Promise.resolve();
}
