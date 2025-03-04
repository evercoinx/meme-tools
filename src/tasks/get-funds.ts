import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
    getSolBalance,
    getTokenAccountInfo,
    importKeypairFromFile,
    importMintKeypair,
    importSwapperKeypairs,
    KeypairKind,
} from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    connectionPool,
    envVars,
    logger,
    OUTPUT_UNKNOWN_PUBLIC_KEY,
    OUTPUT_UNKNOWN_VALUE,
    storage,
    UNITS_PER_MINT,
} from "../modules";
import { STORAGE_RAYDIUM_LP_MINT } from "../modules/storage";
import { RAYDIUM_LP_MINT_DECIMALS } from "../modules/raydium";

(async () => {
    try {
        await fileExists(storage.cacheDirPath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const distributor = await importKeypairFromFile(KeypairKind.Distributor);
        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const traders = importSwapperKeypairs(KeypairKind.Trader);
        const mint = importMintKeypair();

        await getFunds(dev, distributor, snipers, traders, mint);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function getFunds(
    dev: Keypair,
    distributor: Keypair,
    snipers: Keypair[],
    traders: Keypair[],
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of [dev, distributor, ...snipers, ...traders].entries()) {
        const isDev = i === 0;
        const isDistributor = i === 1;
        const isSniper = i >= 2 && i < 2 + snipers.length;

        const solBalance = await getSolBalance(connectionPool, account);

        let mintTokenAccount: PublicKey | undefined;
        let mintTokenBalance: Decimal | undefined;
        if (mint) {
            [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );
        }

        const logParams = [
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            mintTokenAccount
                ? formatPublicKey(mintTokenAccount, "long")
                : OUTPUT_UNKNOWN_PUBLIC_KEY,
            mintTokenBalance
                ? formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS)
                : OUTPUT_UNKNOWN_VALUE,
            envVars.TOKEN_SYMBOL,
        ];

        if (isDev) {
            let lpMintTokenAccount: PublicKey | undefined;
            let lpMintTokenBalance: Decimal | undefined;

            const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
            if (lpMint) {
                [lpMintTokenAccount, lpMintTokenBalance] = await getTokenAccountInfo(
                    connectionPool,
                    account,
                    new PublicKey(lpMint),
                    TOKEN_PROGRAM_ID
                );
            }

            logger.info(
                "Dev funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n\t\t%s - %s LP-%s\n",
                ...logParams,
                lpMintTokenAccount
                    ? formatPublicKey(lpMintTokenAccount, "long")
                    : OUTPUT_UNKNOWN_PUBLIC_KEY,
                lpMintTokenBalance
                    ? formatDecimal(
                          lpMintTokenBalance.div(10 ** RAYDIUM_LP_MINT_DECIMALS),
                          RAYDIUM_LP_MINT_DECIMALS
                      )
                    : OUTPUT_UNKNOWN_VALUE,
                envVars.TOKEN_SYMBOL
            );
        } else {
            logger.info(
                "%s funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n",
                isDistributor
                    ? "Distributor"
                    : isSniper
                      ? `Sniper #${i - 2}`
                      : `Trader #${i - 2 - snipers.length}`,
                ...logParams
            );
        }
    }
}
