import pkg from "../../package.json";
import { envVars, logger, pinataClient } from "../modules";

(async () => {
    try {
        const groupId = await getGroup(`${pkg.name}-${envVars.NODE_ENV}`);

        await deleteFiles(groupId);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function getGroup(groupName: string): Promise<string> {
    const groups = await pinataClient.groups.list().name(groupName);
    if (groups.length === 0) {
        throw new Error(`Group not found: ${groupName}`);
    }

    return groups[0].id;
}

async function deleteFiles(groupId: string): Promise<void> {
    const filesToUnpin = [];

    const imageFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.webp`;
    const imageFileToUnpin = await findFileToUnpin(groupId, imageFileName);
    if (imageFileToUnpin) {
        filesToUnpin.push(imageFileToUnpin);
    } else {
        logger.warn("Mint image file not found: %s", imageFileName);
    }

    const metadataFilename = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const metadataFileToUnpin = await findFileToUnpin(groupId, metadataFilename);
    if (metadataFileToUnpin) {
        filesToUnpin.push(metadataFileToUnpin);
    } else {
        logger.warn("Mint metadata file not found: %s", metadataFilename);
    }

    if (filesToUnpin.length > 0) {
        await pinataClient.unpin(filesToUnpin);
        logger.info("Mint files deleted: %d", filesToUnpin.length);
    }
}

async function findFileToUnpin(groupId: string, fileName: string): Promise<string | undefined> {
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(fileName);

    return pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === fileName
        ? pinnedFiles[0].ipfs_pin_hash
        : undefined;
}
