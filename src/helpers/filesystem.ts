import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { IMAGE_DIR, STORAGE_DIR } from "../modules";

export async function checkIfImageExists(name: string, extension: string): Promise<void> {
    const normalizedName = name.toLowerCase();
    const fileName = `${normalizedName}.${extension}`;

    try {
        await access(join(IMAGE_DIR, fileName));
    } catch {
        throw new Error(`Image '${fileName}' not exists`);
    }
}

export async function checkIfStorageExists(fileName: string): Promise<void> {
    const normalizedFileName = fileName.toLowerCase();
    try {
        await access(join(STORAGE_DIR, normalizedFileName));
    } catch {
        throw new Error(`Storage '${normalizedFileName}' not exists`);
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
