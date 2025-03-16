import { parseArgs } from "node:util";
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
import { checkFileExists } from "../helpers/filesystem";
import {
    formatDecimal,
    formatError,
    formatPublicKey,
    OUTPUT_UNKNOWN_PUBLIC_KEY,
    OUTPUT_UNKNOWN_VALUE,
} from "../helpers/format";
import { connectionPool, envVars, logger, storage, UNITS_PER_MINT } from "../modules";
import { STORAGE_RAYDIUM_LP_MINT } from "../modules/storage";
import { RAYDIUM_LP_MINT_DECIMALS } from "../modules/raydium";

enum Mode {
    ALL = "all",
    MAIN = "main",
    SWAPPER = "swapper",
}

(async () => {
    try {
        const {
            values: { mode },
        } = parseArgs({
            options: {
                mode: {
                    type: "string",
                    default: Mode.ALL,
                },
            },
        });

        if (![Mode.ALL, Mode.MAIN, Mode.SWAPPER].includes(mode as Mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }
        if ([Mode.ALL, Mode.SWAPPER].includes(mode as Mode)) {
            await checkFileExists(storage.cacheFilePath);
        }

        const mint = importMintKeypair();

        if ([Mode.ALL, Mode.MAIN].includes(mode as Mode)) {
            const dev = await importKeypairFromFile(KeypairKind.Dev);
            const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
            const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
            await getMainFunds(dev, sniperDistributor, traderDistributor, mint);
        }

        if ([Mode.ALL, Mode.SWAPPER].includes(mode as Mode)) {
            const snipers = importSwapperKeypairs(KeypairKind.Sniper);
            const traders = importSwapperKeypairs(KeypairKind.Trader);
            await getSwapperFunds(snipers, traders, mint);
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function getMainFunds(
    dev: Keypair,
    sniperDistributor: Keypair,
    traderDistributor: Keypair,
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of [dev, sniperDistributor, traderDistributor].entries()) {
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

        if (i === 0) {
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
                "%s distributor funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n",
                i === 1 ? "Sniper" : "Trader",
                ...logParams
            );
        }
    }
}

async function getSwapperFunds(
    snipers: Keypair[],
    traders: Keypair[],
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of [...snipers, ...traders].entries()) {
        const isSniper = i < snipers.length;

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

        logger.info(
            "%s funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n",
            isSniper ? `Sniper #${i}` : `Trader #${i - snipers.length}`,
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            mintTokenAccount
                ? formatPublicKey(mintTokenAccount, "long")
                : OUTPUT_UNKNOWN_PUBLIC_KEY,
            mintTokenBalance
                ? formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS)
                : OUTPUT_UNKNOWN_VALUE,
            envVars.TOKEN_SYMBOL
        );
    }
}
