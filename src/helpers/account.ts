import fs from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { capitalize, formatPublicKey } from "./format";
import { encryption, logger, storage, STORAGE_MINT_SECRET_KEY, SwapperType } from "../modules";
import { Pool } from "../modules/pool";

export async function importLocalKeypair(path: string, id: string): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(path, "utf8"));
    const account = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug("%s (%s) key pair imported", capitalize(id), formatPublicKey(account.publicKey));
    return account;
}

export function generateOrImportMintKeypair(): Keypair {
    let mint: Keypair | undefined;

    const encryptedSecretKey = storage.get<string | undefined>(STORAGE_MINT_SECRET_KEY);
    if (encryptedSecretKey) {
        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        mint = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.debug("Mint (%s) key pair imported", formatPublicKey(mint.publicKey));
    } else {
        mint = Keypair.generate();
        logger.info("Mint (%s) key pair generated", formatPublicKey(mint.publicKey));

        const encryptedMint = encryption.encrypt(JSON.stringify(Array.from(mint.secretKey)));
        storage.set(STORAGE_MINT_SECRET_KEY, encryptedMint);
        storage.save();
        logger.debug("Mint (%s) key pair saved to storage", formatPublicKey(mint.publicKey));
    }

    return mint;
}

export function importMintKeypair(): Keypair | undefined {
    const encryptedSecretKey = storage.get<string | undefined>(STORAGE_MINT_SECRET_KEY);
    if (!encryptedSecretKey) {
        return;
    }

    const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
    const mint = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug("Mint (%s) key pair imported", formatPublicKey(mint.publicKey));

    return mint;
}

export function generateOrImportSwapperKeypairs(
    swapperCount: number,
    swapperType: SwapperType
): Keypair[] {
    const swappers: Keypair[] = [];
    const storageKeys = generateSecretStorageKeys(swapperCount, swapperType);

    for (let i = 0; i < swapperCount; i++) {
        let swapper: Keypair | undefined;

        const encryptedSecretKey = storage.get<string | undefined>(storageKeys[i]);
        if (encryptedSecretKey) {
            const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
            swapper = Keypair.fromSecretKey(Uint8Array.from(secretKey));
            logger.debug(
                "%s (%s) key pair imported",
                capitalize(swapperType),
                formatPublicKey(swapper.publicKey)
            );
        } else {
            swapper = Keypair.generate();
            logger.info(
                `%s (%s) key pair generated`,
                capitalize(swapperType),
                formatPublicKey(swapper.publicKey)
            );

            const encryptedSwapper = encryption.encrypt(
                JSON.stringify(Array.from(swapper.secretKey))
            );
            storage.set(storageKeys[i], encryptedSwapper);
            storage.save();
            logger.debug(
                "%s (%s) secret key saved to storage",
                capitalize(swapperType),
                formatPublicKey(swapper.publicKey)
            );
        }

        swappers.push(swapper);
    }

    return swappers;
}

export function importSwapperKeypairs(swapperCount: number, swapperType: SwapperType): Keypair[] {
    const swappers: Keypair[] = [];
    const storageKeys = generateSecretStorageKeys(swapperCount, swapperType);

    for (let i = 0; i < swapperCount; i++) {
        const encryptedSecretKey = storage.get<string>(storageKeys[i]);
        if (!encryptedSecretKey) {
            throw new Error(`${capitalize(swapperType)} secret key not loaded from storage`);
        }

        const secretKey: number[] = JSON.parse(encryption.decrypt(encryptedSecretKey));
        const swapper = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        logger.debug(
            "%s (%s) key pair imported",
            capitalize(swapperType),
            formatPublicKey(swapper.publicKey)
        );

        swappers.push(swapper);
    }

    return swappers;
}

function generateSecretStorageKeys(
    keyCount: number,
    swapperType: SwapperType
): Record<number, string> {
    const secretKeyRecord: Record<number, string> = {};
    for (let i = 0; i < keyCount; i++) {
        secretKeyRecord[i] = `${swapperType}_${i}_secret_key`;
    }
    return secretKeyRecord;
}

export async function getAccountSolBalance(
    connectionPool: Pool<Connection>,
    publicKey: PublicKey
): Promise<Decimal> {
    const connection = connectionPool.current();

    try {
        return getBalance(connection, publicKey);
    } catch {
        logger.warn("Failed to get balance for account (%s). Retrying 1/2");
        connectionPool.next();

        try {
            return getBalance(connection, publicKey);
        } catch {
            logger.warn("Failed to get balance for account (%s). Retrying 2/2");
            connectionPool.next();

            return getBalance(connection, publicKey);
        }
    }
}

async function getBalance(connection: Connection, publicKey: PublicKey): Promise<Decimal> {
    return new Decimal(await connection.getBalance(publicKey));
}
