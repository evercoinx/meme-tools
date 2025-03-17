import fs from "node:fs/promises";
import { basename, join } from "node:path";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { encryption, envVars, KEYPAIR_DIR, logger, storage } from "../modules";
import { Pool } from "../modules/pool";
import {
    STORAGE_MINT_SECRET_KEY,
    STORAGE_SNIPER_COUNT,
    STORAGE_TRADER_COUNT,
} from "../modules/storage";
import { findFileNames } from "./filesystem";
import { capitalize, formatInteger, formatPublicKey, formatText } from "./format";

export const KEYPAIR_FILE_EXTENSION = ".json";

export enum KeypairKind {
    Dev = "dev",
    SniperDistributor = "sniperDistributor",
    TraderDistributor = "traderDistributor",
    Sniper = "sniper",
    Trader = "trader",
}

const KEYPAIR_MASKS: Record<KeypairKind, [string, string] | null> = {
    [KeypairKind.Dev]: ["De", "V"],
    [KeypairKind.SniperDistributor]: ["Ds", "N"],
    [KeypairKind.TraderDistributor]: ["Dt", "R"],
    [KeypairKind.Sniper]: null,
    [KeypairKind.Trader]: null,
};

export async function importKeypairFromFile(keypairKind: KeypairKind): Promise<Keypair> {
    const keypairMask = KEYPAIR_MASKS[keypairKind];
    if (!keypairMask) {
        throw new Error(`${capitalize(keypairKind)} key pair mask not defined`);
    }

    const fileNames = await findFileNames(
        KEYPAIR_DIR,
        keypairMask[0],
        keypairMask[1],
        KEYPAIR_FILE_EXTENSION
    );
    if (fileNames.length === 0) {
        throw new Error(`${capitalize(keypairKind)} key pair file not found`);
    }
    if (fileNames.length >= 2) {
        throw new Error(`Multiple key pair files found: ${formatInteger(fileNames.length)}`);
    }

    const filePath = join(KEYPAIR_DIR, fileNames[0]);
    const secretKey: number[] = JSON.parse(await fs.readFile(filePath, "utf8"));

    const account = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    logger.debug(
        "%s (%s) key pair loaded from file: %s",
        capitalize(keypairKind),
        formatPublicKey(account.publicKey),
        basename(filePath)
    );
    return account;
}

export function generateOrImportMintKeypair(): Keypair {
    let mint: Keypair | undefined;

    const encryptedSecretKey = storage.get<string | undefined>(STORAGE_MINT_SECRET_KEY);
    if (encryptedSecretKey) {
        const secretKey = encryption.decrypt(encryptedSecretKey);
        mint = Keypair.fromSecretKey(secretKey);
        logger.debug("Mint (%s) key pair loaded from storage", formatPublicKey(mint.publicKey));
    } else {
        mint = Keypair.generate();
        logger.info("Mint (%s) key pair generated", formatPublicKey(mint.publicKey));

        const encryptedMintSecretKey = encryption.encrypt(mint.secretKey);
        storage.set(STORAGE_MINT_SECRET_KEY, encryptedMintSecretKey);
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

    const secretKey = encryption.decrypt(encryptedSecretKey);
    const mint = Keypair.fromSecretKey(secretKey);
    logger.debug("Mint (%s) key pair loaded from storage", formatPublicKey(mint.publicKey));

    return mint;
}

export function generateOrImportSwapperKeypairs(
    count: number,
    keypairKind: KeypairKind,
    dryRun = false
): Keypair[] {
    if (![KeypairKind.Sniper, KeypairKind.Trader].includes(keypairKind)) {
        throw new Error(`Unexpected key pair kind: ${formatText(keypairKind)}`);
    }

    const swappers: Keypair[] = [];
    const storageKeys = generateSecretStorageKeys(count, keypairKind);

    for (let i = 0; i < count; i++) {
        let swapper: Keypair | undefined;

        const encryptedSecretKey = storage.get<string | undefined>(storageKeys[i]);
        if (encryptedSecretKey) {
            const secretKey = encryption.decrypt(encryptedSecretKey);
            swapper = Keypair.fromSecretKey(secretKey);

            if (!dryRun) {
                logger.debug(
                    "%s (%s) key pair loaded from stroage",
                    capitalize(keypairKind),
                    formatPublicKey(swapper.publicKey)
                );
            }
        } else {
            swapper = Keypair.generate();

            if (!dryRun) {
                logger.info(
                    "%s (%s) key pair generated",
                    capitalize(keypairKind),
                    formatPublicKey(swapper.publicKey)
                );

                const encryptedSwapperSecretKey = encryption.encrypt(swapper.secretKey);
                storage.set(storageKeys[i], encryptedSwapperSecretKey);
                storage.save();
                logger.debug(
                    "%s (%s) secret key saved to storage",
                    capitalize(keypairKind),
                    formatPublicKey(swapper.publicKey)
                );
            }
        }

        swappers.push(swapper);
    }

    if (!dryRun) {
        const storageCountKey =
            keypairKind === KeypairKind.Sniper ? STORAGE_SNIPER_COUNT : STORAGE_TRADER_COUNT;
        const savedCount = storage.get<number | undefined>(storageCountKey);

        if (savedCount === undefined || count > savedCount) {
            storage.set(storageCountKey, count);
            storage.save();
            logger.debug(
                "%s count %s saved to storage",
                capitalize(keypairKind),
                formatInteger(count)
            );
        }
    }

    return swappers;
}

export function importSwapperKeypairs(keypairKind: KeypairKind): Keypair[] {
    if (![KeypairKind.Sniper, KeypairKind.Trader].includes(keypairKind)) {
        throw new Error(`Unexpected key pair kind: ${formatText(keypairKind)}`);
    }

    const storageCountKey =
        keypairKind === KeypairKind.Sniper ? STORAGE_SNIPER_COUNT : STORAGE_TRADER_COUNT;

    const count = storage.get<number | undefined>(storageCountKey);
    if (count === undefined) {
        throw new Error(`${capitalize(keypairKind)} count not loaded from storage`);
    }

    const swappers: Keypair[] = [];
    const storageKeys = generateSecretStorageKeys(count, keypairKind);

    for (let i = 0; i < count; i++) {
        const encryptedSecretKey = storage.get<string>(storageKeys[i]);
        if (!encryptedSecretKey) {
            throw new Error(
                `${capitalize(keypairKind)} secret key ${formatInteger(i)} not loaded from storage`
            );
        }

        const secretKey = encryption.decrypt(encryptedSecretKey);
        const swapper = Keypair.fromSecretKey(secretKey);
        logger.debug(
            "%s (%s) key pair loaded from storage",
            capitalize(keypairKind),
            formatPublicKey(swapper.publicKey)
        );

        swappers.push(swapper);
    }

    return swappers;
}

function generateSecretStorageKeys(
    keyCount: number,
    keypairKind: KeypairKind
): Record<number, string> {
    const secretKeyRecord: Record<number, string> = {};
    for (let i = 0; i < keyCount; i++) {
        secretKeyRecord[i] = `${keypairKind}_${i}_secret_key`;
    }
    return secretKeyRecord;
}

export async function getSolBalance(
    connectionPool: Pool<Connection>,
    account: Keypair
): Promise<Decimal> {
    try {
        return getBalance(connectionPool.current(), account.publicKey);
    } catch {
        logger.warn(
            "Failed to get SOL balance of account (%s). Attempt: 1/2",
            formatPublicKey(account.publicKey)
        );

        try {
            return getBalance(connectionPool.next(), account.publicKey);
        } catch {
            logger.warn(
                "Failed to get SOL balance of account (%s). Attempt: 2/2",
                formatPublicKey(account.publicKey)
            );
            connectionPool.next();

            return getBalance(connectionPool.next(), account.publicKey);
        }
    }
}

async function getBalance(connection: Connection, publicKey: PublicKey): Promise<Decimal> {
    return new Decimal(await connection.getBalance(publicKey));
}

export async function getTokenAccountInfo(
    connectionPool: Pool<Connection>,
    account: Keypair,
    mint: PublicKey,
    splTokenProgram: PublicKey
): Promise<[PublicKey, Decimal | undefined]> {
    const tokenAccount = getAssociatedTokenAddressSync(
        mint,
        account.publicKey,
        false,
        splTokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    try {
        return [tokenAccount, await getTokenAccountBalance(connectionPool.current(), tokenAccount)];
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("could not find account")) {
            return [tokenAccount, undefined];
        }

        logger.warn(
            "Failed to get balance for %s ATA (%s) of account (%s). Attempt: 1/2",
            envVars.TOKEN_SYMBOL,
            formatPublicKey(tokenAccount),
            formatPublicKey(account.publicKey)
        );

        try {
            return [
                tokenAccount,
                await getTokenAccountBalance(connectionPool.next(), tokenAccount),
            ];
        } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("could not find account")) {
                return [tokenAccount, undefined];
            }

            logger.warn(
                "Failed to get balance for %s ATA (%s) of account (%s). Attempt: 2/2",
                envVars.TOKEN_SYMBOL,
                formatPublicKey(tokenAccount),
                formatPublicKey(account.publicKey)
            );

            return [
                tokenAccount,
                await getTokenAccountBalance(connectionPool.next(), tokenAccount),
            ];
        }
    }
}

async function getTokenAccountBalance(
    connection: Connection,
    publicKey: PublicKey
): Promise<Decimal | undefined> {
    const {
        value: { amount },
    } = await connection.getTokenAccountBalance(publicKey);
    return new Decimal(amount.toString());
}
