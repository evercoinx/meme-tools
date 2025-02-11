import fs from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import {
    encryption,
    logger,
    storage,
    STORAGE_SNIPER_SECRET_KEYS,
    STORAGE_MINT_SECRET_KEY,
} from "../modules";
import { formatPublicKey } from "./format";

export async function importLocalKeypair(path: string, id: string): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(path, "utf8"));
    const account = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug(
        "%s%s (%s) imported",
        id.slice(0, 1).toUpperCase(),
        id.slice(1),
        formatPublicKey(account.publicKey)
    );
    return account;
}

export function generateMintKeypair(): Keypair {
    const mint = Keypair.generate();
    logger.info("Mint (%s) generated", formatPublicKey(mint.publicKey));

    const encryptedMint = encryption.encrypt(JSON.stringify(Array.from(mint.secretKey)));
    storage.set(STORAGE_MINT_SECRET_KEY, encryptedMint);
    storage.save();
    logger.debug("Mint (%s) saved to storage", formatPublicKey(mint.publicKey));

    return mint;
}

export function importMintKeypair(): Keypair | undefined {
    const encryptedSecretKey = storage.get<string>(STORAGE_MINT_SECRET_KEY);
    if (!encryptedSecretKey) {
        return;
    }

    const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
    const mint = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug("Mint (%s) imported", formatPublicKey(mint.publicKey));

    return mint;
}

export function generateSniperKeypairs(sniperCount: number): Keypair[] {
    const snipers: Keypair[] = [];

    for (let i = 0; i < sniperCount; i++) {
        const sniper = Keypair.generate();
        logger.info("Sniper (%s) generated", formatPublicKey(sniper.publicKey));

        const encryptedSniper = encryption.encrypt(JSON.stringify(Array.from(sniper.secretKey)));
        storage.set(STORAGE_SNIPER_SECRET_KEYS[i], encryptedSniper);
        storage.save();
        logger.debug("Sniper (%s) secret key saved to storage", formatPublicKey(sniper.publicKey));

        snipers.push(sniper);
    }

    return snipers;
}

export function importSniperKeypairs(sniperCount: number): Keypair[] {
    const snipers: Keypair[] = [];

    for (let i = 0; i < sniperCount; i++) {
        const encryptedSecretKey = storage.get<string>(STORAGE_SNIPER_SECRET_KEYS[i]);
        if (!encryptedSecretKey) {
            throw new Error("Sniper secret key not loaded from storage");
        }

        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        const sniper = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.debug("Sniper (%s) imported", formatPublicKey(sniper.publicKey));

        snipers.push(sniper);
    }

    return snipers;
}
