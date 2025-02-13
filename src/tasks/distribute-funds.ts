import { randomInt } from "node:crypto";
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
import {
    connection,
    envVars,
    logger,
    STORAGE_SNIPER_SECRET_KEYS,
    STORAGE_TRADER_SECRET_KEYS,
    SwapperType,
} from "../modules";

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

        const traders = storageExists
            ? importSwapperKeypairs(
                  envVars.TRADER_COUNT,
                  SwapperType.Trader,
                  STORAGE_TRADER_SECRET_KEYS
              )
            : generateSwapperKeypairs(
                  envVars.TRADER_COUNT,
                  SwapperType.Trader,
                  STORAGE_TRADER_SECRET_KEYS
              );

        const sniperAmounts = envVars.SNIPER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL)
                .mul(percent)
                .plus(envVars.SWAPPER_COMPUTE_BUDGET_SOL)
        );

        const traderAmounts = new Array(envVars.TRADER_COUNT).fill(0).map(() => {
            const index = randomInt(0, 1);
            return new Decimal(envVars.TRADER_AMOUNT_RANGE_SOL[index]).plus(
                envVars.SWAPPER_COMPUTE_BUDGET_SOL
            );
        });

        const sendDistrubuteSniperFundsTransaction = await distributeFunds(
            sniperAmounts,
            distributor,
            snipers
        );
        const sendDistrubuteTraderFundsTransaction = await distributeFunds(
            traderAmounts,
            distributor,
            traders
        );

        await Promise.all([
            sendDistrubuteSniperFundsTransaction,
            sendDistrubuteTraderFundsTransaction,
        ]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeFunds(
    amounts: Decimal[],
    distributor: Keypair,
    accounts: Keypair[]
): Promise<Promise<void>> {
    const instructions: TransactionInstruction[] = [];

    for (const [i, account] of accounts.entries()) {
        const lamports = amounts[i].mul(LAMPORTS_PER_SOL);
        const solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));

        if (solBalance.gte(lamports)) {
            logger.warn(
                "Sniper #%d (%s) has sufficient balance: %s SOL",
                i,
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            const residualLamports = lamports.sub(solBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: account.publicKey,
                    lamports: residualLamports.toNumber(),
                })
            );
        }

        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            account.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
        if (wsolAccountInfo) {
            logger.warn(
                "WSOL ATA (%s) exists for account #%d (%s)",
                wsolTokenAccount.toBase58(),
                i,
                account.publicKey.toBase58()
            );
        } else {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    distributor.publicKey,
                    wsolTokenAccount,
                    account.publicKey,
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
              `to distribute funds from distributor (${formatPublicKey(distributor.publicKey)}) to ${accounts.length} accounts`,
              "Low"
          )
        : Promise.resolve();
}
