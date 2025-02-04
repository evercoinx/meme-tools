import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importDevKeypair, importHolderKeypairs, importMintKeypair } from "../helpers/account";
import { checkIfFileExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
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
            const wsolAssociatedTokenAccount = getAssociatedTokenAddressSync(
                NATIVE_MINT,
                account.publicKey,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            const wsolTokenAccountBalance = await connection.getTokenAccountBalance(
                wsolAssociatedTokenAccount,
                "confirmed"
            );
            const wsolBalance = new Decimal(wsolTokenAccountBalance.value.amount.toString());

            let mintAssociatedTokenAccount: PublicKey | null = null;
            let mintBalance: Decimal | null = null;
            if (mint) {
                mintAssociatedTokenAccount = getAssociatedTokenAddressSync(
                    mint.publicKey,
                    account.publicKey,
                    false,
                    TOKEN_2022_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );

                try {
                    const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                        mintAssociatedTokenAccount,
                        "confirmed"
                    );
                    mintBalance = new Decimal(mintTokenAccountBalance.value.amount.toString());
                } catch {
                    // Ignore Account not found error
                }
            }

            logger.info(
                "Funds info (%s)\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s",
                i === 0 ? "Dev" : `Holder #${i - 1}`,
                account.publicKey.toBase58(),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                wsolAssociatedTokenAccount.toBase58(),
                wsolBalance ? formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL)) : "?",
                mintAssociatedTokenAccount ? mintAssociatedTokenAccount.toBase58() : "?",
                mintBalance ? formatDecimal(mintBalance.div(10 ** envVars.TOKEN_DECIMALS), 6) : "?",
                envVars.TOKEN_SYMBOL
            );
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
