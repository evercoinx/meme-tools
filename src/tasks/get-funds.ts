import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importLocalKeypair, importHolderKeypairs, importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { checkIfStorageExists } from "../helpers/validation";
import {
    connection,
    envVars,
    logger,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
} from "../modules";

const UNKNOWN_ADDRESS = "?".repeat(44);

(async () => {
    try {
        await checkIfStorageExists();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );
        const holders = importHolderKeypairs(envVars.HOLDER_SHARE_POOL_PERCENTS.length);
        const mint = importMintKeypair();

        for (const [i, account] of [dev, distributor, ...holders].entries()) {
            const isDev = i === 0;
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
                    // Ignore TokenAccountNotFoundError error
                }
            }

            const logParams = [
                account.publicKey.toBase58(),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
                wsolAssociatedTokenAccount.toBase58(),
                wsolBalance ? formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL)) : "?",
                mintAssociatedTokenAccount
                    ? mintAssociatedTokenAccount.toBase58()
                    : UNKNOWN_ADDRESS,
                mintBalance
                    ? formatDecimal(
                          mintBalance.div(10 ** envVars.TOKEN_DECIMALS),
                          envVars.TOKEN_DECIMALS
                      )
                    : "?",
                envVars.TOKEN_SYMBOL,
            ];

            if (isDev) {
                let lpMintAssociatedTokenAccount: PublicKey | null = null;
                let lpMintBalance: Decimal | null = null;

                const lpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
                if (lpMint) {
                    lpMintAssociatedTokenAccount = getAssociatedTokenAddressSync(
                        new PublicKey(lpMint),
                        account.publicKey,
                        false,
                        TOKEN_PROGRAM_ID,
                        ASSOCIATED_TOKEN_PROGRAM_ID
                    );

                    try {
                        const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                            lpMintAssociatedTokenAccount,
                            "confirmed"
                        );
                        lpMintBalance = new Decimal(
                            mintTokenAccountBalance.value.amount.toString()
                        );
                    } catch {
                        // Ignore TokenAccountNotFoundError error
                    }
                }

                logger.info(
                    "Funds (%s)\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s\n\t\t%s - %s LP-%s",
                    "Dev",
                    ...logParams,
                    lpMintAssociatedTokenAccount
                        ? lpMintAssociatedTokenAccount.toBase58()
                        : UNKNOWN_ADDRESS,
                    lpMintBalance
                        ? formatDecimal(
                              lpMintBalance.div(10 ** RAYDIUM_LP_MINT_DECIMALS),
                              RAYDIUM_LP_MINT_DECIMALS
                          )
                        : "?",
                    envVars.TOKEN_SYMBOL
                );
            } else {
                logger.info(
                    "Funds info (%s)\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s",
                    `Holder #${i - 1}`,
                    ...logParams
                );
            }
        }
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
