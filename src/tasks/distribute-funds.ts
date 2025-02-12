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
    generateSwapperKeypairs,
    importLocalKeypair,
    importSwapperKeypairs,
} from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import { connection, envVars, logger, STORAGE_SNIPER_SECRET_KEYS, SwapperType } from "../modules";

(async () => {
    try {
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const storageExists = await checkIfStorageExists(true);
        const snipers = storageExists
            ? importSwapperKeypairs(
                  envVars.SNIPER_SHARE_POOL_PERCENTS.length,
                  SwapperType.Sniper,
                  STORAGE_SNIPER_SECRET_KEYS
              )
            : generateSwapperKeypairs(
                  envVars.SNIPER_SHARE_POOL_PERCENTS.length,
                  SwapperType.Sniper,
                  STORAGE_SNIPER_SECRET_KEYS
              );

        const amounts = envVars.SNIPER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL)
                .mul(percent)
                .plus(envVars.SWAPPER_COMPUTE_BUDGET_SOL)
        );

        const sendDistrubuteFundsTransaction = await distributeFunds(amounts, distributor, snipers);
        await Promise.all([sendDistrubuteFundsTransaction]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeFunds(
    amounts: Decimal[],
    distributor: Keypair,
    snipers: Keypair[]
): Promise<Promise<void>> {
    const instructions: TransactionInstruction[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const lamports = amounts[i].mul(LAMPORTS_PER_SOL);
        const solBalance = new Decimal(await connection.getBalance(sniper.publicKey, "confirmed"));

        if (solBalance.gte(lamports)) {
            logger.warn(
                "Sniper #%d (%s) has sufficient balance: %s SOL",
                i,
                formatPublicKey(sniper.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            const residualLamports = lamports.sub(solBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: sniper.publicKey,
                    lamports: residualLamports.toNumber(),
                })
            );
        }

        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            sniper.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
        if (wsolAccountInfo) {
            logger.warn(
                "WSOL ATA (%s) exists for sniper #%d (%s)",
                wsolTokenAccount.toBase58(),
                i,
                sniper.publicKey.toBase58()
            );
        } else {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    distributor.publicKey,
                    wsolTokenAccount,
                    sniper.publicKey,
                    NATIVE_MINT,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )
            );
        }
    }

    return instructions.length > 0
        ? sendAndConfirmVersionedTransaction(
              connection,
              instructions,
              [distributor],
              `to distribute funds from distributor (${formatPublicKey(distributor.publicKey)}) to ${snipers.length} snipers`,
              "Low"
          )
        : Promise.resolve();
}
