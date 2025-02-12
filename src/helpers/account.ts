import fs from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import { encryption, logger, storage, STORAGE_MINT_SECRET_KEY, SwapperType } from "../modules";
import { capitalize, formatPublicKey } from "./format";

export async function importLocalKeypair(path: string, id: string): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(path, "utf8"));
    const account = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug("%s (%s) imported", capitalize(id), formatPublicKey(account.publicKey));
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

export function generateSwapperKeypairs(
    swapperCount: number,
    swapperType: SwapperType,
    storageKeys: Record<number, string>
): Keypair[] {
    const swappers: Keypair[] = [];

    for (let i = 0; i < swapperCount; i++) {
        const swapper = Keypair.generate();
        logger.info(
            `%s (%s) generated`,
            capitalize(swapperType),
            formatPublicKey(swapper.publicKey)
        );

        const encryptedSniper = encryption.encrypt(JSON.stringify(Array.from(swapper.secretKey)));
        storage.set(storageKeys[i], encryptedSniper);
        storage.save();
        logger.debug(
            "%s (%s) secret key saved to storage",
            capitalize(swapperType),
            formatPublicKey(swapper.publicKey)
        );

        swappers.push(swapper);
    }

    return swappers;
}

export function importSwapperKeypairs(
    swapperCount: number,
    swapperType: SwapperType,
    storageKeys: Record<number, string>
): Keypair[] {
    const swappers: Keypair[] = [];

    for (let i = 0; i < swapperCount; i++) {
        const encryptedSecretKey = storage.get<string>(storageKeys[i]);
        if (!encryptedSecretKey) {
            throw new Error(`${capitalize(swapperType)} secret key not loaded from storage`);
        }

        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        const swapper = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.debug(
            "%s (%s) imported",
            capitalize(swapperType),
            formatPublicKey(swapper.publicKey)
        );

        swappers.push(swapper);
    }

    return swappers;
}
