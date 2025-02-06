import fs from "node:fs/promises";
import path from "node:path";
import { Cluster } from "@solana/web3.js";
import { storage, STORAGE_DIR } from "../modules";

export function checkIfSupportedByRaydium(cluster: Cluster): void {
    if (!["devnet", "mainnet-beta"].includes(cluster)) {
        throw new Error(`Unsupported cluster for Raydium: ${cluster}`);
    }
}

export async function checkIfStorageExists(silentOnError = false): Promise<boolean> {
    const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
    if (!storageExists && !silentOnError) {
        throw new Error(`Storage ${storage.cacheId} not exists`);
    }
    return storageExists;
}

async function checkIfFileExists(path: string) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
