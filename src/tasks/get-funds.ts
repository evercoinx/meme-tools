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
    capitalize,
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
    SNIPER = "sniper",
    TRADER = "trader",
    WHALE = "whale",
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

        if (![Mode.ALL, Mode.MAIN, Mode.SNIPER, Mode.TRADER, Mode.WHALE].includes(mode as Mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }

        if ([Mode.ALL, Mode.SNIPER, Mode.TRADER, Mode.WHALE].includes(mode as Mode)) {
            await checkFileExists(storage.cacheFilePath);
        }

        const mint = importMintKeypair();

        if ([Mode.ALL, Mode.MAIN].includes(mode as Mode)) {
            const dev = await importKeypairFromFile(KeypairKind.Dev);
            const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
            const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
            const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);
            await getMainFunds(dev, sniperDistributor, traderDistributor, whaleDistributor, mint);
        }

        if ([Mode.ALL, Mode.SNIPER].includes(mode as Mode)) {
            const snipers = importSwapperKeypairs(KeypairKind.Sniper);
            await getSwapperFunds(snipers, KeypairKind.Sniper, mint);
        }

        if ([Mode.ALL, Mode.TRADER].includes(mode as Mode)) {
            const traders = importSwapperKeypairs(KeypairKind.Trader);
            await getSwapperFunds(traders, KeypairKind.Trader, mint);
        }

        if ([Mode.ALL, Mode.WHALE].includes(mode as Mode)) {
            const whales = importSwapperKeypairs(KeypairKind.Whale);
            await getSwapperFunds(whales, KeypairKind.Whale, mint);
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
    whaleDistributor: Keypair,
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of [
        dev,
        sniperDistributor,
        traderDistributor,
        whaleDistributor,
    ].entries()) {
        const solBalance = await getSolBalance(connectionPool, account);

        let mintTokenAccount: PublicKey | undefined;
        let mintTokenBalance: Decimal | undefined;
        let mintTokenInitialized: boolean | undefined;

        if (mint) {
            [mintTokenAccount, mintTokenBalance, mintTokenInitialized] = await getTokenAccountInfo(
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
            mintTokenInitialized && mintTokenBalance !== undefined
                ? formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS)
                : OUTPUT_UNKNOWN_VALUE,
            envVars.TOKEN_SYMBOL,
        ];

        if (i === 0) {
            let lpMintTokenAccount: PublicKey | undefined;
            let lpMintTokenBalance: Decimal | undefined;
            let lpMintTokenInitialized: boolean | undefined;

            const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
            if (lpMint) {
                [lpMintTokenAccount, lpMintTokenBalance, lpMintTokenInitialized] =
                    await getTokenAccountInfo(
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
                lpMintTokenInitialized && lpMintTokenBalance !== undefined
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
    accounts: Keypair[],
    keypairKind: KeypairKind,
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of accounts.entries()) {
        const solBalance = await getSolBalance(connectionPool, account);
        let mintTokenAccount: PublicKey | undefined;
        let mintTokenBalance: Decimal | undefined;
        let mintTokenInitialized: boolean | undefined;

        if (mint) {
            [mintTokenAccount, mintTokenBalance, mintTokenInitialized] = await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );
        }

        logger.info(
            "%s #%d funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n",
            capitalize(keypairKind),
            i,
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            mintTokenAccount
                ? formatPublicKey(mintTokenAccount, "long")
                : OUTPUT_UNKNOWN_PUBLIC_KEY,
            mintTokenInitialized && mintTokenBalance !== undefined
                ? formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS)
                : OUTPUT_UNKNOWN_VALUE,
            envVars.TOKEN_SYMBOL
        );
    }
}
