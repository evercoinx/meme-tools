import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    AuthorityType,
    createAssociatedTokenAccountInstruction,
    createInitializeMetadataPointerInstruction,
    createInitializeMintInstruction,
    createMintToInstruction,
    createSetAuthorityInstruction,
    ExtensionType,
    getAssociatedTokenAddressSync,
    getMint,
    getMintLen,
    LENGTH_SIZE,
    Mint,
    TOKEN_2022_PROGRAM_ID,
    TYPE_SIZE,
} from "@solana/spl-token";
import {
    createInitializeInstruction,
    createUpdateFieldInstruction,
    pack,
    TokenMetadata,
} from "@solana/spl-token-metadata";
import { Keypair, PublicKey, SystemProgram, TransactionSignature } from "@solana/web3.js";
import { PriorityLevel } from "helius-sdk";
import { imageSize } from "image-size";
import pkg from "../../package.json";
import {
    generateOrImportMintKeypair,
    importKeypairFromFile,
    KeypairKind,
} from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import {
    capitalize,
    formatDecimal,
    formatError,
    formatInteger,
    formatPublicKey,
    formatText,
    formatUri,
} from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    IMAGE_DIR,
    logger,
    MINT_IMAGE_FILE_NAME,
    MINT_IMAGE_TYPE,
    pinataClient,
    storage,
    UNITS_PER_MINT,
} from "../modules";
import { STORAGE_MINT_IMAGE_URI, STORAGE_MINT_METADATA } from "../modules/storage";

interface OffchainTokenMetadata {
    name: string;
    symbol: string;
    description: string;
    decimals: number;
    image: string;
    uri?: string;
    external_url?: string;
    social_links?: Record<string, string>;
    tags?: string[];
    attributes?: Record<string, { trait_type: string; value: string }>[];
}

const MIN_MINT_IMAGE_DIMENSION = 100;
const MAX_MINT_IMAGE_DIMENSION = 500;
const MAX_FILE_SIZE = 4_500_000;

const generateOffchainTokenMetadata = (
    symbol: string,
    name: string,
    description: string,
    decimals: number,
    imageUri: string,
    tags: Set<string>,
    websiteUri?: string,
    twitterUri?: string,
    telegramUri?: string
): Omit<OffchainTokenMetadata, "uri"> => {
    if (tags.size === 0) {
        throw new Error("Tags must have at least one item");
    }

    const normalizedSymbol = symbol.toUpperCase();
    const [tag] = tags;
    const defaultName = `Official ${normalizedSymbol} ${capitalize(tag)}`;

    const metadata: OffchainTokenMetadata = {
        symbol: normalizedSymbol,
        name: name || defaultName,
        description: description || `${defaultName} on Solana`,
        decimals,
        image: imageUri,
    };

    metadata.tags = Array.from(tags);

    if (websiteUri) {
        metadata.external_url = websiteUri;
    }
    if (twitterUri) {
        metadata.social_links ??= {};
        metadata.social_links.twitter = twitterUri;
    }
    if (telegramUri) {
        metadata.social_links ??= {};
        metadata.social_links.telegram = telegramUri;
    }

    return metadata;
};

const generatePinataUri = (ipfsHash: string): string =>
    `${envVars.IPFS_GATEWAY_URI}/ipfs/${ipfsHash}`;

(async () => {
    try {
        await checkFileExists(join(IMAGE_DIR, MINT_IMAGE_FILE_NAME));

        const mint = generateOrImportMintKeypair();
        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const groupId = await getOrCreateGroupId(`${pkg.name}-${envVars.NODE_ENV}`);
        const imageUri = await uploadMintImage(groupId);
        const metadata = await uploadMetadata(groupId, imageUri);

        const sendCreateMintTransaction = await createMint(metadata, dev, mint);
        await Promise.all([sendCreateMintTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function getOrCreateGroupId(groupName: string): Promise<string> {
    const groups = await pinataClient.groups.list().name(groupName);
    let groupId: string;

    if (groups.length > 0) {
        groupId = groups[0].id;
    } else {
        ({ id: groupId } = await pinataClient.groups.create({ name: groupName }));
        logger.info("Pinata group created: %s", groupName);
    }

    return groupId;
}

async function uploadMintImage(groupId: string): Promise<string> {
    let imageUri = storage.get<string | undefined>(STORAGE_MINT_IMAGE_URI);
    if (imageUri) {
        logger.debug("Mint image URI loaded from storage");
        return imageUri;
    }

    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(MINT_IMAGE_FILE_NAME);

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === MINT_IMAGE_FILE_NAME) {
        imageUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn(
            "Mint image file already uploaded to IPFS: %s",
            formatUri(imageUri, "<File link>")
        );
    } else {
        logger.debug("Uploading mint image file to IPFS");
        const imageContents = await readFile(join(IMAGE_DIR, MINT_IMAGE_FILE_NAME));
        checkMintImage(imageContents);

        const imageBlob = new Blob([imageContents]);
        const imageFile = new File([imageBlob], MINT_IMAGE_FILE_NAME, {
            type: `image/${MINT_IMAGE_TYPE}`,
        });

        const upload = await pinataClient.upload.file(imageFile).group(groupId);
        imageUri = generatePinataUri(upload.IpfsHash);
        logger.info("Mint image file uploaded to IPFS: %s", formatUri(imageUri, "<File link>"));
    }

    storage.set(STORAGE_MINT_IMAGE_URI, imageUri);
    storage.save();
    logger.debug("Mint image URI saved to storage");

    return imageUri;
}

function checkMintImage(imageContents: Buffer<ArrayBufferLike>): void {
    if (imageContents.byteLength > MAX_FILE_SIZE) {
        throw new Error(`Too large mint image size: ${formatInteger(imageContents.byteLength)}`);
    }

    const { width, height, type } = imageSize(imageContents);
    if (width !== height) {
        throw new Error(`Invalid mint image aspect ratio: 1:${formatDecimal(width / height, 2)}`);
    }
    if (
        width < MIN_MINT_IMAGE_DIMENSION ||
        width > MAX_MINT_IMAGE_DIMENSION ||
        height < MIN_MINT_IMAGE_DIMENSION ||
        height > MAX_MINT_IMAGE_DIMENSION
    ) {
        throw new Error(
            `Invalid mint image dimensions: ${formatInteger(width)}x${formatInteger(height)}`
        );
    }
    if (type !== MINT_IMAGE_TYPE) {
        throw new Error(`Invalid mint image type: ${formatText(type ?? "unknown")}`);
    }
}

async function uploadMetadata(groupId: string, imageUri: string): Promise<OffchainTokenMetadata> {
    let metadata = storage.get<OffchainTokenMetadata | undefined>(STORAGE_MINT_METADATA);
    if (metadata) {
        logger.debug("Mint metadata file loaded from storage");
        return metadata;
    }

    metadata = generateOffchainTokenMetadata(
        envVars.TOKEN_SYMBOL,
        envVars.TOKEN_NAME,
        envVars.TOKEN_DESCRIPTION,
        envVars.TOKEN_DECIMALS,
        imageUri,
        envVars.TOKEN_TAGS,
        envVars.TOKEN_WEBSITE_URI,
        envVars.TOKEN_TWITTER_URI,
        envVars.TOKEN_TELEGRAM_URI
    );

    const metadataFilename = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(metadataFilename);
    let metadataUri = "";

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === metadataFilename) {
        metadataUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn(
            "Mint metadata file already uploaded to IPFS: %s",
            formatUri(metadataUri, "<File link>")
        );
    } else {
        logger.debug("Uploading mint metadata file to IPFS");
        const metadataFileContents = JSON.stringify(metadata);
        const metadataFileSize = Buffer.from(metadataFileContents, "utf8").byteLength;
        if (metadataFileSize > MAX_FILE_SIZE) {
            throw new Error(`Too large metadata file size: ${formatInteger(metadataFileSize)}`);
        }

        const metadataFile = new File([metadataFileContents], metadataFilename, {
            type: "text/plain",
        });

        const upload = await pinataClient.upload.file(metadataFile).group(groupId);
        metadataUri = generatePinataUri(upload.IpfsHash);
        logger.info(
            "Mint metadata file uploaded to IPFS: %s",
            formatUri(metadataUri, "<File link>")
        );
    }

    metadata.uri = metadataUri;

    storage.set(STORAGE_MINT_METADATA, metadata);
    storage.save();
    logger.debug("Mint metadata saved to storage");

    return metadata;
}

async function createMint(
    offchainTokenMetadata: OffchainTokenMetadata,
    dev: Keypair,
    mint: Keypair
): Promise<Promise<TransactionSignature | undefined>> {
    let mintInfo: Mint | undefined;
    try {
        mintInfo = await getMint(
            connectionPool.next(),
            mint.publicKey,
            "confirmed",
            TOKEN_2022_PROGRAM_ID
        );
    } catch {
        // Ignore NotFound error
    }
    if (mintInfo) {
        logger.warn("Mint (%s) already created", mint.publicKey.toBase58());
        return Promise.resolve(undefined);
    }

    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const metadata: TokenMetadata = {
        mint: mint.publicKey,
        updateAuthority: PublicKey.default,
        name: offchainTokenMetadata.name,
        symbol: offchainTokenMetadata.symbol,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        uri: offchainTokenMetadata.uri!,
        additionalMetadata: [],
    };

    if (offchainTokenMetadata.external_url) {
        metadata.additionalMetadata.push(["website", offchainTokenMetadata.external_url]);
    }
    if (offchainTokenMetadata.social_links?.twitter) {
        metadata.additionalMetadata.push(["twitter", offchainTokenMetadata.social_links.twitter]);
    }
    if (offchainTokenMetadata.social_links?.telegram) {
        metadata.additionalMetadata.push(["telegram", offchainTokenMetadata.social_links.telegram]);
    }

    // Size of Mint account with MetadataPointer extension
    const mintSize = getMintLen([ExtensionType.MetadataPointer]);
    // Size of Metadata extension: 2 bytes for type, 2 bytes for length
    const metadataExtensionSize = TYPE_SIZE + LENGTH_SIZE;
    // Size of metadata
    const metadataSize = pack(metadata).length;
    // Minimum lamports required for Mint account
    const mintLamports = await connection.getMinimumBalanceForRentExemption(
        mintSize + metadataExtensionSize + metadataSize
    );

    const tokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        dev.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions = [
        // Create a new mint account
        SystemProgram.createAccount({
            fromPubkey: dev.publicKey,
            newAccountPubkey: mint.publicKey,
            space: mintSize,
            lamports: mintLamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        // Initialize the metadata pointer for the mint account
        createInitializeMetadataPointerInstruction(
            mint.publicKey,
            null,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        ),
        // Initialize the mint account
        createInitializeMintInstruction(
            mint.publicKey,
            envVars.TOKEN_DECIMALS,
            dev.publicKey,
            null,
            TOKEN_2022_PROGRAM_ID
        ),
        // Initialize the metadata account
        createInitializeInstruction({
            mint: mint.publicKey,
            mintAuthority: dev.publicKey,
            updateAuthority: dev.publicKey,
            metadata: mint.publicKey,
            name: metadata.name,
            symbol: metadata.symbol,
            uri: metadata.uri,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
    ];

    for (const [field, value] of metadata.additionalMetadata) {
        instructions.push(
            // Add a custom field to the metadata account
            createUpdateFieldInstruction({
                metadata: mint.publicKey,
                updateAuthority: dev.publicKey,
                field,
                value,
                programId: TOKEN_2022_PROGRAM_ID,
            })
        );
    }

    instructions.push(
        // Create the associated token account of the owner
        createAssociatedTokenAccountInstruction(
            dev.publicKey,
            tokenAccount,
            dev.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        // Mint to the associated token account of the owner
        createMintToInstruction(
            mint.publicKey,
            tokenAccount,
            dev.publicKey,
            envVars.TOKEN_SUPPLY * UNITS_PER_MINT,
            [],
            TOKEN_2022_PROGRAM_ID
        ),
        // Revoke the MintTokens authority from the owner
        createSetAuthorityInstruction(
            mint.publicKey,
            dev.publicKey,
            AuthorityType.MintTokens,
            null,
            [],
            TOKEN_2022_PROGRAM_ID
        )
    );

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.DEFAULT,
        instructions,
        [dev, mint]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev, mint],
        `to create mint (${formatPublicKey(mint.publicKey)})`
    );
}
