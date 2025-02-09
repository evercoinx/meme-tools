import fs from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import {
    encryption,
    logger,
    storage,
    STORAGE_HOLDER_SECRET_KEYS,
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

export function generateHolderKeypairs(holderCount: number): Keypair[] {
    const holders: Keypair[] = [];

    for (let i = 0; i < holderCount; i++) {
        const holder = Keypair.generate();
        logger.info("Holder (%s) generated", formatPublicKey(holder.publicKey));

        const encryptedHolder = encryption.encrypt(JSON.stringify(Array.from(holder.secretKey)));
        storage.set(STORAGE_HOLDER_SECRET_KEYS[i], encryptedHolder);
        storage.save();
        logger.debug("Holder (%s) secret key saved to storage", formatPublicKey(holder.publicKey));

        holders.push(holder);
    }

    return holders;
}

export function importHolderKeypairs(holderCount: number): Keypair[] {
    const holders: Keypair[] = [];

    for (let i = 0; i < holderCount; i++) {
        const encryptedSecretKey = storage.get<string>(STORAGE_HOLDER_SECRET_KEYS[i]);
        if (!encryptedSecretKey) {
            throw new Error("Holder secret key not loaded from storage");
        }

        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        const holder = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.debug("Holder (%s) imported", formatPublicKey(holder.publicKey));

        holders.push(holder);
    }

    return holders;
}
