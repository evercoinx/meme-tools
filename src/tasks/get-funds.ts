import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount,
    getAssociatedTokenAddress,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importDevKeypair, importHolderKeypairs, importMintKeypair } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { decimal } from "../helpers/format";
import { connection, envVars, logger, storage, STORAGE_DIR } from "../modules";

(async () => {
    try {
        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);
        const holders = importHolderKeypairs();
        const mint = importMintKeypair();

        for (const [i, account] of [dev, ...holders].entries()) {
            const solBalance = new Decimal(await connection.getBalance(account.publicKey));
            const wsolAssociatedTokenAccount = await getAssociatedTokenAddress(
                NATIVE_MINT,
                account.publicKey,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            let wsolBalance: Decimal | null = null;
            try {
                const account = await getAccount(
                    connection,
                    wsolAssociatedTokenAccount,
                    "confirmed",
                    TOKEN_PROGRAM_ID
                );
                wsolBalance = new Decimal(account.amount.toString(10));
            } catch {
                // Do nothing
            }

            const mintAssociatedTokenAccount = await getAssociatedTokenAddress(
                mint.publicKey,
                account.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            let mintBalance: Decimal | null = null;
            try {
                const account = await getAccount(
                    connection,
                    mintAssociatedTokenAccount,
                    "confirmed",
                    TOKEN_2022_PROGRAM_ID
                );
                mintBalance = new Decimal(account.amount.toString(10));
                console.log(account.amount, "))))))");
            } catch {
                // Do nothing
            }

            logger.info(
                "Funds info (%s)\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s",
                i === 0 ? "Dev" : `Holder #${i - 1}`,
                account.publicKey.toBase58(),
                decimal.format(solBalance.div(LAMPORTS_PER_SOL).toNumber()),
                wsolAssociatedTokenAccount.toBase58(),
                wsolBalance ? decimal.format(wsolBalance.div(LAMPORTS_PER_SOL).toNumber()) : "?",
                mintAssociatedTokenAccount.toBase58(),
                mintBalance
                    ? decimal.format(mintBalance.div(envVars.TOKEN_DECIMALS).toNumber())
                    : "?",
                envVars.TOKEN_SYMBOL
            );
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
