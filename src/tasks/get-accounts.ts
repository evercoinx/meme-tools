import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
    importSwapperKeypairs,
    importKeypairFromFile,
    importMintKeypair,
} from "../helpers/account";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import { formatPublicKey } from "../helpers/format";
import { envVars, logger, OUTPUT_UNKNOWN_KEY, storage, SwapperType } from "../modules";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const dev = await importKeypairFromFile(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importKeypairFromFile(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);
        const mint = importMintKeypair();

        getAccounts(dev, distributor, snipers, traders, mint);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

function getAccounts(
    dev: Keypair,
    distributor: Keypair,
    snipers: Keypair[],
    traders: Keypair[],
    mint?: Keypair
): void {
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
        mint ? formatPublicKey(mint.publicKey, "long") : OUTPUT_UNKNOWN_KEY,
        mint ? bs58.encode(mint.secretKey) : OUTPUT_UNKNOWN_KEY
    );

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
