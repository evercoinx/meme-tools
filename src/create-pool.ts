import fs from "node:fs/promises";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { cache, envVars, logger } from "./common";

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
    const secretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    const balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
        await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    }
    logger.info(`Payer ${payer.publicKey.toBase58()} imported`);

    const mintSecretKey = cache.get<string>("mint");
    if (!mintSecretKey) {
        throw new Error(`Mint not loaded from cache`);
    }

    const mint = Keypair.fromSecretKey(Buffer.from(mintSecretKey, "utf-8"));
    logger.info(`Mint ${mint.publicKey.toBase58()} imported`);

    return [payer, mint];
}
