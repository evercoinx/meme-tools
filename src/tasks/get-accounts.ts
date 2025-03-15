import { parseArgs } from "node:util";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
    importSwapperKeypairs,
    importKeypairFromFile,
    importMintKeypair,
    KeypairKind,
} from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
import { formatError, formatPublicKey, OUTPUT_UNKNOWN_PUBLIC_KEY } from "../helpers/format";
import { logger, storage } from "../modules";

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
            await fileExists(storage.cacheFilePath);
        }

        if ([Mode.ALL, Mode.MAIN].includes(mode as Mode)) {
            const dev = await importKeypairFromFile(KeypairKind.Dev);
            const distributor = await importKeypairFromFile(KeypairKind.Distributor);
            const mint = importMintKeypair();
            getMainAccounts(dev, distributor, mint);
        }

        if ([Mode.ALL, Mode.SWAPPER].includes(mode as Mode)) {
            const snipers = importSwapperKeypairs(KeypairKind.Sniper);
            const traders = importSwapperKeypairs(KeypairKind.Trader);
            getSwapperAccounts(snipers, traders);
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

function getMainAccounts(dev: Keypair, distributor: Keypair, mint?: Keypair): void {
    logger.info(
        "Dev keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        formatPublicKey(dev.publicKey, "long"),
        bs58.encode(dev.secretKey)
    );

    logger.info(
        "Distributor keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        formatPublicKey(distributor.publicKey, "long"),
        bs58.encode(distributor.secretKey)
    );

    logger.info(
        "Mint keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        mint ? formatPublicKey(mint.publicKey, "long") : OUTPUT_UNKNOWN_PUBLIC_KEY,
        mint ? bs58.encode(mint.secretKey) : OUTPUT_UNKNOWN_PUBLIC_KEY
    );
}

function getSwapperAccounts(snipers: Keypair[], traders: Keypair[]): void {
    for (const [i, sniper] of snipers.entries()) {
        logger.info(
            "Sniper #%d keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
            i,
            formatPublicKey(sniper.publicKey, "long"),
            bs58.encode(sniper.secretKey)
        );
    }

    for (const [i, trader] of traders.entries()) {
        logger.info(
            "Trader #%d keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
            i,
            formatPublicKey(trader.publicKey, "long"),
            bs58.encode(trader.secretKey)
        );
    }
}
