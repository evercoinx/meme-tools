import { parseArgs } from "node:util";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
    importSwapperKeypairs,
    importKeypairFromFile,
    importMintKeypair,
    KeypairKind,
} from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import {
    capitalize,
    formatError,
    formatPublicKey,
    formatText,
    OUTPUT_UNKNOWN_PUBLIC_KEY,
} from "../helpers/format";
import { logger, storage } from "../modules";

enum Mode {
    ALL = "all",
    MAIN = "main",
    SNIPER = "sniper",
    TRADER = "trader",
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

        if (![Mode.ALL, Mode.MAIN, Mode.SNIPER, Mode.TRADER].includes(mode as Mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }

        if ([Mode.ALL, Mode.SNIPER, Mode.TRADER].includes(mode as Mode)) {
            await checkFileExists(storage.cacheFilePath);
        }

        if ([Mode.ALL, Mode.MAIN].includes(mode as Mode)) {
            const dev = await importKeypairFromFile(KeypairKind.Dev);
            const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
            const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
            const mint = importMintKeypair();
            getMainAccounts(dev, sniperDistributor, traderDistributor, mint);
        }

        if ([Mode.ALL, Mode.SNIPER].includes(mode as Mode)) {
            const snipers = importSwapperKeypairs(KeypairKind.Sniper);
            getSwapperAccounts(snipers, KeypairKind.Sniper);
        }

        if ([Mode.ALL, Mode.TRADER].includes(mode as Mode)) {
            const traders = importSwapperKeypairs(KeypairKind.Trader);
            getSwapperAccounts(traders, KeypairKind.Trader);
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

function getMainAccounts(
    dev: Keypair,
    sniperDistributor: Keypair,
    traderDistributor: Keypair,
    mint?: Keypair
): void {
    logger.info(
        "Dev keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        formatPublicKey(dev.publicKey, "long"),
        formatText(bs58.encode(dev.secretKey))
    );

    logger.info(
        "Sniper distributor keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        formatPublicKey(sniperDistributor.publicKey, "long"),
        formatText(bs58.encode(sniperDistributor.secretKey))
    );

    logger.info(
        "Trader distributor keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        formatPublicKey(traderDistributor.publicKey, "long"),
        formatText(bs58.encode(traderDistributor.secretKey))
    );

    logger.info(
        "Mint keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        mint ? formatPublicKey(mint.publicKey, "long") : OUTPUT_UNKNOWN_PUBLIC_KEY,
        mint ? formatText(bs58.encode(mint.secretKey)) : OUTPUT_UNKNOWN_PUBLIC_KEY
    );
}

function getSwapperAccounts(accounts: Keypair[], keypairKind: KeypairKind): void {
    for (const [i, account] of accounts.entries()) {
        logger.info(
            "%s #%d keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
            capitalize(keypairKind),
            i,
            formatPublicKey(account.publicKey, "long"),
            formatText(bs58.encode(account.secretKey))
        );
    }
}
