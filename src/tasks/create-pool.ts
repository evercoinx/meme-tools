import fs from "node:fs/promises";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { encryption, envVars, keyring, KEYRING_KEY_MINT, logger } from "./init";

(async () => {
    try {
        const connection = new Connection(envVars.RPC_URI, "confirmed");
        await importKeypairs(connection);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function importKeypairs(connection: Connection): Promise<[Keypair, Keypair]> {
    const secretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    const balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
        await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    }
    logger.info(`Payer ${payer.publicKey.toBase58()} imported`);

    const encryptedMint = keyring.get<string>(KEYRING_KEY_MINT);
    if (!encryptedMint) {
        throw new Error(`Mint not loaded from keyring`);
    }

    const mintSecretKey: number[] = JSON.parse(encryption.decrypt(encryptedMint));
    const mint = Keypair.fromSecretKey(Uint8Array.from(mintSecretKey));
    logger.info(`Mint ${mint.publicKey.toBase58()} imported`);

    return [payer, mint];
}
