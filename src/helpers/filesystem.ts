import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { STORAGE_DIR } from "../modules";

export async function checkIfStorageExists(cacheId: string): Promise<void> {
    try {
        await access(join(STORAGE_DIR, cacheId));
    } catch {
        throw new Error(`Storage ${cacheId} not exists`);
    }
}

export async function formatStorage(cacheId: string): Promise<void> {
    const filepath = join(STORAGE_DIR, cacheId);
    const fileContents = await readFile(filepath, "utf8");
    const options = await resolveConfig(filepath);

    const formattedJson = await format(fileContents, {
        ...options,
        filepath,
    });
    await writeFile(filepath, formattedJson);
}
