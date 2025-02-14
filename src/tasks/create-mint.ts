import fs from "node:fs/promises";
import path from "node:path";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    AuthorityType,
    createAssociatedTokenAccountInstruction,
    createInitializeMetadataPointerInstruction,
    createInitializeMintInstruction,
    createMintToInstruction,
    createSetAuthorityInstruction,
    ExtensionType,
    getAssociatedTokenAddress,
    getMintLen,
    LENGTH_SIZE,
    TOKEN_2022_PROGRAM_ID,
    TYPE_SIZE,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, TokenMetadata } from "@solana/spl-token-metadata";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { generateMintKeypair, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    IMAGE_DIR,
    logger,
    METADATA_DIR,
    pinataClient,
    storage,
    STORAGE_MINT_IMAGE_URI,
    STORAGE_MINT_METADATA,
} from "../modules";

interface OffchainTokenMetadata {
    name: string;
    symbol: string;
    description: string;
    image: string;
    uri: string;
    external_url: string;
    social_links: Record<string, string>;
    tags: string[];
}

const generatePinataUri = (ipfsHash: string) => `${envVars.IPFS_GATEWAY}/ipfs/${ipfsHash}`;

(async () => {
    try {
        await checkIfStorageExists();

        let mint = importMintKeypair();
        if (mint) {
            throw new Error(`Mint ${mint.publicKey.toBase58()} already created`);
        }
        mint = generateMintKeypair();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");

        const imageUri = await uploadImage();
        const metadata = await uploadMetadata(imageUri);

        const sendCreateMintTransaction = await createMint(metadata, dev, mint);
        await Promise.all([sendCreateMintTransaction]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function uploadImage(): Promise<string> {
    let imageUri = storage.get<string | undefined>(STORAGE_MINT_IMAGE_URI);
    if (imageUri) {
        logger.debug("Mint image URI loaded from storage");
        return imageUri;
    }

    const imageFileName = `${envVars.TOKEN_SYMBOL.toLowerCase()}.webp`;
    const pinnedFiles = await pinataClient.listFiles().name(imageFileName);

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === imageFileName) {
        imageUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn("Mint image file already uploaded to IPFS: %s", imageUri);
    } else {
        logger.debug("Uploading mint image file to IPFS");
        const imageBlob = new Blob([await fs.readFile(path.join(IMAGE_DIR, imageFileName))]);

        const imageFile = new File([imageBlob], imageFileName, { type: "image/webp" });
        const upload = await pinataClient.upload.file(imageFile);

        imageUri = generatePinataUri(upload.IpfsHash);
        logger.info("Mint image file uploaded to IPFS: %s", imageUri);
    }

    storage.set(STORAGE_MINT_IMAGE_URI, imageUri);
    storage.save();
    logger.debug("Mint image URI saved to storage");

    return imageUri;
}

async function uploadMetadata(imageUri: string): Promise<OffchainTokenMetadata> {
    let metadata = storage.get<OffchainTokenMetadata | undefined>(STORAGE_MINT_METADATA);
    if (metadata) {
        logger.debug("Mint metadata file loaded from storage");
        return metadata;
    }

    const metadataFilename = `${envVars.TOKEN_SYMBOL.toLowerCase()}.json`;
    const metadataContents = await fs.readFile(path.join(METADATA_DIR, metadataFilename), "utf8");
    metadata = {
        ...JSON.parse(metadataContents),
        image: imageUri,
    } as OffchainTokenMetadata;

    let metadataUri = "";
    const pinnedFiles = await pinataClient.listFiles().name(metadataFilename);

    if (pinnedFiles.length > 0 && pinnedFiles[0].metadata.name === metadataFilename) {
        metadataUri = generatePinataUri(pinnedFiles[0].ipfs_pin_hash);
        logger.warn("Mint metadata file already uploaded to IPFS: %s", metadataUri);
    } else {
        logger.debug("Uploading mint metadata file to IPFS");
        const metadataFile = new File([JSON.stringify(metadata)], metadataFilename, {
            type: "text/plain",
        });
        const upload = await pinataClient.upload.file(metadataFile);

        metadataUri = generatePinataUri(upload.IpfsHash);
        logger.info("Mint metadata file uploaded to IPFS: %s", metadataUri);
    }

    metadata = {
        ...metadata,
        uri: metadataUri,
    };

    storage.set(STORAGE_MINT_METADATA, metadata);
    storage.save();
    logger.debug("Mint metadata saved to storage");

    return metadata;
}

async function createMint(
    offchainMetadata: OffchainTokenMetadata,
    dev: Keypair,
    mint: Keypair
): Promise<Promise<void>> {
    const metadata: TokenMetadata = {
        mint: mint.publicKey,
        updateAuthority: PublicKey.default,
        name: offchainMetadata.name,
        symbol: offchainMetadata.symbol,
        uri: offchainMetadata.uri,
        additionalMetadata: [],
    };
    // Size of Mint account with MetadataPointer extension
    const mintSize = getMintLen([ExtensionType.MetadataPointer]);
    // Size of Metadata extension: 2 bytes for type, 2 bytes for length
    const metadataExtensionSize = TYPE_SIZE + LENGTH_SIZE;
    // Size of metadata
    const metadataSize = pack(metadata).length;
    // Minimum lamports required for Mint account
    const mintLamports = await connectionPool[0].getMinimumBalanceForRentExemption(
        mintSize + metadataExtensionSize + metadataSize
    );

    const associatedTokenAccount = await getAssociatedTokenAddress(
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
            associatedTokenAccount,
            dev.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        // Mint to the associated token account of the owner
        createMintToInstruction(
            mint.publicKey,
            associatedTokenAccount,
            dev.publicKey,
            envVars.TOKEN_SUPPLY * 10 ** envVars.TOKEN_DECIMALS,
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

    return sendAndConfirmVersionedTransaction(
        connectionPool[1],
        heliusClientPool[1],
        instructions,
        [dev, mint],
        `to create mint (${formatPublicKey(mint.publicKey)})`,
        "Medium"
    );
}
