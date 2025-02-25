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
import { createInitializeInstruction, pack, TokenMetadata } from "@solana/spl-token-metadata";
import { Keypair, PublicKey, SystemProgram, TransactionSignature } from "@solana/web3.js";
import chalk from "chalk";
import { PriorityLevel } from "helius-sdk";
import pkg from "../../package.json";
import { generateOrImportMintKeypair, importLocalKeypair } from "../helpers/account";
import { checkIfImageExists } from "../helpers/filesystem";
import { formatPublicKey } from "../helpers/format";
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
    pinataClient,
    storage,
    STORAGE_MINT_IMAGE_URI,
    STORAGE_MINT_METADATA,
    UNITS_PER_MINT,
} from "../modules";

interface FullTokenMetadata {
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

const generateOffchainTokenMetadata = (
    symbol: string,
    name: string,
    description: string,
    decimals: number,
    imageUri: string
): Pick<FullTokenMetadata, "name" | "symbol" | "description" | "decimals" | "image"> => {
    const normalizedSymbol = symbol.toUpperCase();
    return {
        symbol: normalizedSymbol,
        name: name || `Official ${normalizedSymbol} Meme`,
        description: description || `Official ${normalizedSymbol} Meme on Solana`,
        decimals,
        image: imageUri,
    };
};

const generatePinataUri = (ipfsHash: string): string => `${envVars.IPFS_GATEWAY}/ipfs/${ipfsHash}`;

(async () => {
    try {
        await checkIfImageExists(envVars.TOKEN_SYMBOL, "webp");

        const mint = generateOrImportMintKeypair();
        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");

        const groupId = await getOrCreateGroup(`${pkg.name}-${envVars.NODE_ENV}`);
        const imageUri = await uploadImage(groupId);
        const metadata = await uploadMetadata(groupId, imageUri);

        const sendCreateMintTransaction = await createMint(metadata, dev, mint);
        await Promise.all([sendCreateMintTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function getOrCreateGroup(groupName: string): Promise<string> {
    const groups = await pinataClient.groups.list().name(groupName);
    let groupId: string;

    if (groups.length > 0) {
        groupId = groups[0].id;
    } else {
        ({ id: groupId } = await pinataClient.groups.create({ name: groupName }));
        logger.warn("Pinata group created: %s", groupId);
    }

    return groupId;
}

async function uploadImage(groupId: string): Promise<string> {
    let imageUri = storage.get<string | undefined>(STORAGE_MINT_IMAGE_URI);
    if (imageUri) {
        logger.debug("Mint image URI loaded from storage");
        return imageUri;
    }

    const imageFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.webp`;
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(imageFileName);

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === imageFileName) {
        imageUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn("Mint image file already uploaded to IPFS: %s", chalk.blue(imageUri));
    } else {
        logger.debug("Uploading mint image file to IPFS");
        const imageBlob = new Blob([await readFile(join(IMAGE_DIR, imageFileName))]);

        const imageFile = new File([imageBlob], imageFileName, { type: "image/webp" });
        const upload = await pinataClient.upload.file(imageFile).group(groupId);

        imageUri = generatePinataUri(upload.IpfsHash);
        logger.info("Mint image file uploaded to IPFS: %s", chalk.blue(imageUri));
    }

    storage.set(STORAGE_MINT_IMAGE_URI, imageUri);
    storage.save();
    logger.debug("Mint image URI saved to storage");

    return imageUri;
}

async function uploadMetadata(groupId: string, imageUri: string): Promise<FullTokenMetadata> {
    let metadata = storage.get<FullTokenMetadata | undefined>(STORAGE_MINT_METADATA);
    if (metadata) {
        logger.debug("Mint metadata file loaded from storage");
        return metadata;
    }

    metadata = generateOffchainTokenMetadata(
        envVars.TOKEN_SYMBOL,
        envVars.TOKEN_NAME,
        envVars.TOKEN_DESCRIPTION,
        envVars.TOKEN_DECIMALS,
        imageUri
    );

    const metadataFilename = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const pinnedFiles = await pinataClient.listFiles().group(groupId).name(metadataFilename);
    let metadataUri = "";

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === metadataFilename) {
        metadataUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn("Mint metadata file already uploaded to IPFS: %s", chalk.blue(metadataUri));
    } else {
        logger.debug("Uploading mint metadata file to IPFS");
        const metadataFile = new File([JSON.stringify(metadata)], metadataFilename, {
            type: "text/plain",
        });
        const upload = await pinataClient.upload.file(metadataFile).group(groupId);

        metadataUri = generatePinataUri(upload.IpfsHash);
        logger.info("Mint metadata file uploaded to IPFS: %s", metadataUri);
    }

    metadata.uri = metadataUri;

    storage.set(STORAGE_MINT_METADATA, metadata);
    storage.save();
    logger.debug("Mint metadata saved to storage");

    return metadata;
}

async function createMint(
    fullTokenMetadata: FullTokenMetadata,
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
        name: fullTokenMetadata.name,
        symbol: fullTokenMetadata.symbol,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        uri: fullTokenMetadata.uri!,
        additionalMetadata: [],
    };
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
        ),
    ];

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
