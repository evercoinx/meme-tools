import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileExists, fileNotExists } from "../helpers/filesystem";
import { formatError, formatFileName, formatFilePath } from "../helpers/format";
import { KEYPAIR_DIR, logger, storage } from "../modules";
import { STORAGE_FILE_EXTENSION } from "../modules/storage";

(async () => {
    try {
        const sourceKeypairPath = join(dirname(KEYPAIR_DIR), "token");
        const destinationKeypairPath = KEYPAIR_DIR;
        await fileExists(
            sourceKeypairPath,
            `Source key pair path not exists: ${formatFilePath(sourceKeypairPath)}`
        );
        await fileNotExists(
            destinationKeypairPath,
            `Destination key pair path already exists: ${formatFilePath(KEYPAIR_DIR)}`
        );

        const sourceStoragePath = join(
            dirname(storage.cacheFilePath),
            `token${STORAGE_FILE_EXTENSION}`
        );
        const destinationStoragePath = storage.cacheFilePath;
        await fileExists(
            sourceStoragePath,
            `Source storage not exists: ${formatFileName(sourceStoragePath)}`
        );
        await fileNotExists(
            destinationStoragePath,
            `Destination storage already exists: ${formatFileName(destinationStoragePath)}`
        );

        await rename(sourceKeypairPath, destinationKeypairPath);
        logger.info(
            "Key pair path renamed from %s to %s",
            formatFilePath(sourceKeypairPath),
            formatFilePath(destinationKeypairPath)
        );

        await rename(sourceStoragePath, destinationStoragePath);
        logger.info(
            "Storage renamed from %s to %s",
            formatFileName(sourceStoragePath),
            formatFileName(destinationStoragePath)
        );

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();
