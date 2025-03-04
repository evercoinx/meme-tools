import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { format, resolveConfig } from "prettier";

export async function countFiles(dirPath: string, extensions: string[]): Promise<number> {
    try {
        await access(dirPath);
    } catch {
        return 0;
    }

    let count = 0;
    const entries = await readdir(dirPath, {
        withFileTypes: true,
        encoding: "utf8",
    });

    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
            count += await countFiles(fullPath, extensions);
        } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
            count += 1;
        }
    }

    return count;
}

export async function findFileNames(
    dirPath: string,
    prefix: string,
    postfix: string
): Promise<string[]> {
    try {
        await access(dirPath);
    } catch {
        return [];
    }

    const fileNames = await readdir(dirPath, {
        withFileTypes: false,
        encoding: "utf8",
    });
    const matchedFileNames: string[] = [];

    for (const fileName of fileNames) {
        const name = basename(fileName, ".json");
        if (name.startsWith(prefix) && name.endsWith(postfix)) {
            matchedFileNames.push(fileName);
        }
    }

    return matchedFileNames;
}

export async function fileExists(filePath: string): Promise<void> {
    try {
        await access(filePath);
    } catch {
        throw new Error(`File not found: ${basename(filePath)}`);
    }
}

export async function formatStorageFile(filePath: string): Promise<void> {
    const fileContents = await readFile(filePath, "utf8");
    const options = await resolveConfig(filePath);

    const formattedJson = await format(fileContents, {
        ...options,
        filepath: filePath,
    });

    await writeFile(filePath, formattedJson);
}
