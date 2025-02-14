import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE_DIR } from "../modules";

export async function checkIfStorageExists(cacheId: string): Promise<void> {
    try {
        await fs.access(path.join(STORAGE_DIR, cacheId));
    } catch {
        throw new Error(`Storage ${cacheId} not exists`);
    }
}
