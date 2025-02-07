import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { importHolderKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/validation";
import { envVars, logger, UNKNOWN_KEY } from "../modules";

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

        getKeys(dev, distributor, holders, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

function getKeys(dev: Keypair, distributor: Keypair, holders: Keypair[], mint?: Keypair): void {
    logger.info(
        "Dev keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        dev.publicKey.toBase58(),
        bs58.encode(dev.secretKey)
    );

    logger.info(
        "Distributor keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        distributor.publicKey.toBase58(),
        bs58.encode(distributor.secretKey)
    );

    for (const [i, holder] of holders.entries()) {
        logger.info(
            "Holder #%d keys\n\t\tPublic: %s\n\t\tSecret: %s\n\n\t\t",
            i,
            holder.publicKey.toBase58(),
            bs58.encode(holder.secretKey)
        );
    }

    logger.info(
        "Mint keys\n\t\tPublic: %s\n\t\tSecret: %s\n",
        mint ? mint.publicKey.toBase58() : UNKNOWN_KEY,
        mint ? bs58.encode(mint.secretKey) : UNKNOWN_KEY
    );
}
