import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importLocalKeypair, importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
import {
    connection,
    envVars,
    logger,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_SNIPER_SECRET_KEYS,
    STORAGE_TRADER_SECRET_KEYS,
    SwapperType,
    UNKNOWN_KEY,
} from "../modules";

(async () => {
    try {
        await checkIfStorageExists();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );
        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper,
            STORAGE_SNIPER_SECRET_KEYS
        );
        const traders = importSwapperKeypairs(
            envVars.TRADER_COUNT,
            SwapperType.Trader,
            STORAGE_TRADER_SECRET_KEYS
        );
        const mint = importMintKeypair();

        await getFunds([dev, distributor, ...snipers, ...traders], mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getFunds(accounts: Keypair[], mint?: Keypair): Promise<void> {
    for (const [i, account] of accounts.entries()) {
        const isDev = i === 0;
        const isDistributor = i === 1;
        const isSniper = i >= 2 && i < 2 + envVars.SNIPER_SHARE_POOL_PERCENTS.length;

        const solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));
        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            account.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let wsolBalance: Decimal | null = null;
        try {
            const wsolTokenAccountBalance = await connection.getTokenAccountBalance(
                wsolTokenAccount,
                "confirmed"
            );
            wsolBalance = new Decimal(wsolTokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        let mintTokenAccount: PublicKey | null = null;
        let mintBalance: Decimal | null = null;
        if (mint) {
            mintTokenAccount = getAssociatedTokenAddressSync(
                mint.publicKey,
                account.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            try {
                const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                    mintTokenAccount,
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
            wsolTokenAccount.toBase58(),
            wsolBalance ? formatDecimal(wsolBalance.div(LAMPORTS_PER_SOL)) : "?",
            mintTokenAccount ? mintTokenAccount : UNKNOWN_KEY,
            mintBalance
                ? formatDecimal(
                      mintBalance.div(10 ** envVars.TOKEN_DECIMALS),
                      envVars.TOKEN_DECIMALS
                  )
                : "?",
            envVars.TOKEN_SYMBOL,
        ];

        if (isDev) {
            let lpMintTokenAccount: PublicKey | null = null;
            let lpMintBalance: Decimal | null = null;

            const lpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
            if (lpMint) {
                lpMintTokenAccount = getAssociatedTokenAddressSync(
                    new PublicKey(lpMint),
                    account.publicKey,
                    false,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );

                try {
                    const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                        lpMintTokenAccount,
                        "confirmed"
                    );
                    lpMintBalance = new Decimal(mintTokenAccountBalance.value.amount.toString());
                } catch {
                    // Ignore TokenAccountNotFoundError error
                }
            }

            logger.info(
                "Dev funds\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s\n\t\t%s - %s LP-%s\n",
                ...logParams,
                lpMintTokenAccount ? lpMintTokenAccount.toBase58() : UNKNOWN_KEY,
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
                "%s funds\n\t\t%s - %s SOL\n\t\t%s - %s WSOL\n\t\t%s - %s %s\n",
                isDistributor
                    ? "Distributor"
                    : isSniper
                      ? `Sniper #${i - 2}`
                      : `Trader #${i - 2 - envVars.SNIPER_SHARE_POOL_PERCENTS.length}`,
                ...logParams
            );
        }
    }
}
