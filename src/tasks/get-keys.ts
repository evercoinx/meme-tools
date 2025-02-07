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
    const holderOutputs = [];
    for (const [i, holder] of holders.entries()) {
        holderOutputs.push(
            `Holder #${i} (storage)\n\t\tPublic key: ${holder.publicKey.toBase58()}\n\t\tSecret key: ${bs58.encode(holder.secretKey)}\n\n\t\t`
        );
    }

    logger.info(
        "Keys\n\t\tDev (local)\n\t\tPublic key: %s\n\t\tSecret key: %s\n\n\t\tDistributor (local)\n\t\tPublic key: %s\n\t\tSecret key: %s\n\n\t\t%sMint (storage)\n\t\tPublic key: %s\n\t\tSecret key: %s\n",
        dev.publicKey.toBase58(),
        bs58.encode(dev.secretKey),
        distributor.publicKey.toBase58(),
        bs58.encode(distributor.secretKey),
        holderOutputs.join(""),
        mint ? mint.publicKey.toBase58() : UNKNOWN_KEY,
        mint ? bs58.encode(mint.secretKey) : UNKNOWN_KEY
    );
}
