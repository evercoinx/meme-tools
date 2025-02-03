import fs from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import {
    encryption,
    envVars,
    logger,
    storage,
    STORAGE_HOLDER_SECRET_KEYS,
    STORAGE_MINT_SECRET_KEY,
} from "../modules";

export async function importDevKeypair(path: string): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(path, "utf8"));
    const dev = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.info("Dev %s imported", dev.publicKey.toBase58());
    return dev;
}

export function generateMintKeypair(): Keypair {
    const mint = Keypair.generate();
    logger.info("Mint %s generated", mint.publicKey.toBase58());

    const encryptedMint = encryption.encrypt(JSON.stringify(Array.from(mint.secretKey)));
    storage.set(STORAGE_MINT_SECRET_KEY, encryptedMint);
    storage.save();
    logger.debug("Mint %s saved to storage as encrypted", mint.publicKey.toBase58());

    return mint;
}

export function importMintKeypair(): Keypair {
    const encryptedSecretKey = storage.get<string>(STORAGE_MINT_SECRET_KEY);
    if (!encryptedSecretKey) {
        throw new Error("Mint secret key not loaded from storage");
    }

    const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
    const mint = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.info("Mint %s imported", mint.publicKey.toBase58());

    return mint;
}

export function generateHolderKeypairs(): Keypair[] {
    const holders: Keypair[] = [];

    for (let i = 0; i < envVars.HOLDER_COUNT_PER_POOL; i++) {
        const holder = Keypair.generate();
        logger.info("Holder %s generated");

        const encryptedHolder = encryption.encrypt(JSON.stringify(Array.from(holder.secretKey)));
        storage.set(STORAGE_HOLDER_SECRET_KEYS[i], encryptedHolder);
        storage.save();
        logger.debug("Holder %s secret key saved to storage", holder.publicKey.toBase58());

        holders.push(holder);
    }

    return holders;
}

export function importHolderKeypairs(): Keypair[] {
    const holders: Keypair[] = [];

    for (let i = 0; i < envVars.HOLDER_COUNT_PER_POOL; i++) {
        const encryptedSecretKey = storage.get<string>(STORAGE_HOLDER_SECRET_KEYS[i]);
        if (!encryptedSecretKey) {
            throw new Error("Holder secret key not loaded from storage");
        }

        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        const holder = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.info("Holder %s imported", holder.publicKey.toBase58());

        holders.push(holder);
    }

    return holders;
}
