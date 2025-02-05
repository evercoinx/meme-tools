import fs from "node:fs/promises";
import path from "node:path";
import { storage, STORAGE_DIR } from "../modules";

export async function checkIfStorageExists(silentOnError = false) {
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
