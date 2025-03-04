import { rm } from "fs/promises";
import pkg from "../../package.json";
import { checkIfStorageFileExists, countFiles } from "../helpers/filesystem";
import { formatFileName, formatInteger, formatName } from "../helpers/format";
import { envVars, KEYPAIR_DIR, LOG_DIR, logger, pinataClient, storage } from "../modules";

(async () => {
    try {
        if (envVars.NODE_ENV === "production") {
            logger.warn("Cleanup forbidden. Environment: %s", envVars.NODE_ENV);
            process.exit(0);
        }

        await purgeLogFiles();
        if (envVars.NODE_ENV === "test") {
            await purgeKeypairFiles();
        } else {
            logger.warn("Keypair purge skipped");
        }

        await clearStorageFile();

        const groupId = await getGroupId(`${pkg.name}-${envVars.NODE_ENV}`);
        if (groupId) {
            await unpinIpfsFiles(groupId);
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function purgeLogFiles(): Promise<void> {
    const fileCount = await countFiles(LOG_DIR, [".log"]);

    await rm(LOG_DIR, {
        recursive: true,
        force: true,
    });
    logger.info("Logs purged. Total files: %s", formatInteger(fileCount));
}

async function purgeKeypairFiles(): Promise<void> {
    const fileCount = await countFiles(KEYPAIR_DIR, [".json"]);

    await rm(KEYPAIR_DIR, {
        recursive: true,
        force: true,
    });
    logger.info("Keypairs purged. Total files: %s", formatInteger(fileCount));
}

async function clearStorageFile(): Promise<void> {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        storage.clear();
        logger.info("Storage cleared. Total keys: %s", formatInteger(storage.keys().length));
    } catch (error: unknown) {
        logger.warn(error instanceof Error ? error.message : String(error));
    }
}

async function getGroupId(groupName: string): Promise<string | undefined> {
    const groups = await pinataClient.groups.list().name(groupName);
    if (groups.length === 0) {
        logger.warn("Group not found: %s", formatName(groupName));
        return;
    }

    return groups[0].id;
}

async function unpinIpfsFiles(groupId: string): Promise<void> {
    const filesToUnpin: { cid: string; name: string }[] = [];

    const imageFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.webp`;
    const imageFileCid = await findFileCidToUnpin(groupId, imageFileName);
    if (imageFileCid) {
        filesToUnpin.push({
            cid: imageFileCid,
            name: imageFileName,
        });
    } else {
        logger.warn("Mint image file not found: %s", formatFileName(imageFileName));
    }

    const metadataFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const metadataFileCid = await findFileCidToUnpin(groupId, metadataFileName);
    if (metadataFileCid) {
        filesToUnpin.push({
            cid: metadataFileCid,
            name: metadataFileName,
        });
    } else {
        logger.warn("Mint metadata file not found: %s", formatFileName(metadataFileName));
    }

    if (filesToUnpin.length > 0) {
        await pinataClient.unpin(filesToUnpin.map(({ cid }) => cid));

        for (const fileToUnpin of filesToUnpin) {
            logger.info("File unpinned from IPFS: %s", formatFileName(fileToUnpin.name));
        }
    }
}

async function findFileCidToUnpin(groupId: string, fileName: string): Promise<string | undefined> {
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(fileName);

    return pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === fileName
        ? pinnedFiles[0].ipfs_pin_hash
        : undefined;
}
