import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount,
    getAssociatedTokenAddress,
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
            const wsolAssociatedTokenAccount = await getAssociatedTokenAddress(
                NATIVE_MINT,
                account.publicKey,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            let wsolBalance: Decimal | null = null;
            try {
                const { amount } = await getAccount(
                    connection,
                    wsolAssociatedTokenAccount,
                    "confirmed",
                    TOKEN_PROGRAM_ID
                );
                wsolBalance = new Decimal(amount.toString(10));
            } catch {
                // Do nothing
            }

            let mintBalance: Decimal | null = null;
            let mintAssociatedTokenAccount: PublicKey | null = null;

            if (mint) {
                mintAssociatedTokenAccount = await getAssociatedTokenAddress(
                    mint.publicKey,
                    account.publicKey,
                    false,
                    TOKEN_2022_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );

                try {
                    const { amount } = await getAccount(
                        connection,
                        mintAssociatedTokenAccount,
                        "confirmed",
                        TOKEN_2022_PROGRAM_ID
                    );
                    mintBalance = new Decimal(amount.toString(10));
                } catch {
                    // Do nothing
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
