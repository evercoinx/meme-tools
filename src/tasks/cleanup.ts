import { rm } from "fs/promises";
import pkg from "../../package.json";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import { envVars, LOG_DIR, logger, pinataClient, storage } from "../modules";

(async () => {
    try {
        if (envVars.NODE_ENV === "production") {
            logger.error("Cleanup for environment forbidden: %s", envVars.NODE_ENV);
            process.exit(0);
        }

        await purgeLogFiles();
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
    await rm(LOG_DIR, {
        recursive: true,
        force: true,
    });
    logger.info("Log files purged");
}

async function clearStorageFile(): Promise<void> {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        storage.clear();
        logger.info("Storage cleared");
    } catch (error: unknown) {
        logger.warn(error instanceof Error ? error.message : String(error));
    }
}

async function getGroupId(groupName: string): Promise<string | undefined> {
    const groups = await pinataClient.groups.list().name(groupName);
    if (groups.length === 0) {
        logger.warn(`Group not found: ${groupName}`);
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
        logger.warn("Mint image file not found: %s", imageFileName);
    }

    const metadataFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const metadataFileCid = await findFileCidToUnpin(groupId, metadataFileName);
    if (metadataFileCid) {
        filesToUnpin.push({
            cid: metadataFileCid,
            name: metadataFileName,
        });
    } else {
        logger.warn("Mint metadata file not found: %s", metadataFileName);
    }

    if (filesToUnpin.length > 0) {
        await pinataClient.unpin(filesToUnpin.map(({ cid }) => cid));

        for (const fileToUnpin of filesToUnpin) {
            logger.info("File unpinned from IPFS: %s", fileToUnpin.name);
        }
    }
}

async function findFileCidToUnpin(groupId: string, fileName: string): Promise<string | undefined> {
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(fileName);

    return pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === fileName
        ? pinnedFiles[0].ipfs_pin_hash
        : undefined;
}
