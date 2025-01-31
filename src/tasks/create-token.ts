import fs from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";
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
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import { createInitializeInstruction, pack, TokenMetadata } from "@solana/spl-token-metadata";
import {
    connection,
    encryption,
    envVars,
    IMAGE_DIR,
    ipfs,
    logger,
    METADATA_DIR,
    storage,
    STORAGE_DIR,
    STORAGE_IMAGE_URI,
    STORAGE_METADATA,
    STORAGE_MINT_SECRET_KEY,
} from "./init";
import { checkIfFileExists } from "./helpers";

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

const generateIpfsUri = (ipfsHash: string) => `${envVars.IPFS_GATEWAY}/ipfs/${ipfsHash}`;

const args = minimist(process.argv.slice(2), {
    boolean: ["force"],
});

(async () => {
    try {
        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (storageExists && !args.force) {
            throw new Error(`Storage ${storage.cacheId} already exists`);
        }

        const [payer, mint] = await generateKeypairs();

        const imageUri = await uploadImage();
        const metadata = await uploadMetadata(imageUri);

        await createToken(metadata, payer, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function generateKeypairs(): Promise<[Keypair, Keypair]> {
    const payerSecretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(payerSecretKey));

    const balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
        await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    }
    logger.info(`Payer ${payer.publicKey.toBase58()} imported`);

    const mint = Keypair.generate();
    logger.info(`Mint ${mint.publicKey.toBase58()} generated`);

    const encryptedMint = encryption.encrypt(JSON.stringify(Array.from(mint.secretKey)));
    storage.set(STORAGE_MINT_SECRET_KEY, encryptedMint);
    storage.save();
    logger.debug(`Mint ${mint.publicKey.toBase58()} saved to storage`);

    return [payer, mint];
}

async function uploadImage(): Promise<string> {
    let imageUri = storage.get<string>(STORAGE_IMAGE_URI);
    if (imageUri) {
        logger.info("Image loaded from storage");
        return imageUri;
    }

    logger.debug("Uploading image to IPFS...");
    const imageFileName = `${envVars.TOKEN_SYMBOL}.webp`;
    const imageBlob = new Blob([await fs.readFile(path.join(IMAGE_DIR, imageFileName))]);

    const imageFile = new File([imageBlob], imageFileName, { type: "image/webp" });
    const upload = await ipfs.upload.file(imageFile);

    imageUri = generateIpfsUri(upload.IpfsHash);
    logger.info(`Image uploaded to IPFS at ${imageUri}`);

    storage.set(STORAGE_IMAGE_URI, imageUri);
    storage.save();
    logger.debug("Image URI saved to storage");

    return imageUri;
}

async function uploadMetadata(imageUri: string): Promise<OffchainTokenMetadata> {
    let metadata = storage.get<OffchainTokenMetadata>(STORAGE_METADATA);
    if (metadata) {
        logger.info("Metadata loaded from storage");
        return metadata;
    }

    logger.debug(`Uploading metadata to IPFS...`);
    const metadataFilename = `${envVars.TOKEN_SYMBOL}.json`;
    metadata = {
        ...JSON.parse(await fs.readFile(path.join(METADATA_DIR, metadataFilename), "utf8")),
        image: imageUri,
    };

    const metadataFile = new File([JSON.stringify(metadata)], metadataFilename, {
        type: "text/plain",
    });
    const upload = await ipfs.upload.file(metadataFile);

    const metadataUri = generateIpfsUri(upload.IpfsHash);
    metadata = {
        ...metadata,
        uri: metadataUri,
    };
    logger.info(`Metadata uploaded to IPFS at ${metadataUri}`);

    storage.set(STORAGE_METADATA, metadata);
    storage.save();
    logger.debug("Metadata saved to storage");

    return metadata;
}

async function createToken(
    offchainMetadata: OffchainTokenMetadata,
    payer: Keypair,
    mint: Keypair
): Promise<void> {
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
    const mintLamports = await connection.getMinimumBalanceForRentExemption(
        mintSize + metadataExtensionSize + metadataSize
    );

    const associatedToken = await getAssociatedTokenAddress(
        mint.publicKey,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction();
    transaction.add(
        // Invoke the System program to create a new account
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            space: mintSize,
            lamports: mintLamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        // Initialize the MetadataPointer extension
        createInitializeMetadataPointerInstruction(
            mint.publicKey,
            null,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
        ),
        // Initialize Mint account data
        createInitializeMintInstruction(
            mint.publicKey,
            envVars.TOKEN_DECIMALS,
            payer.publicKey,
            null,
            TOKEN_2022_PROGRAM_ID
        ),
        // Initialize Metadata account data
        createInitializeInstruction({
            mint: mint.publicKey,
            mintAuthority: payer.publicKey,
            updateAuthority: payer.publicKey,
            metadata: mint.publicKey,
            name: metadata.name,
            symbol: metadata.symbol,
            uri: metadata.uri,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        // Create the Associated token account connecting the Owner account with the Mint account
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            associatedToken,
            payer.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        // Mint tokens to the Owner's Associated token account
        createMintToInstruction(
            mint.publicKey,
            associatedToken,
            payer.publicKey,
            envVars.TOKEN_SUPPLY * 10 ** envVars.TOKEN_DECIMALS,
            [],
            TOKEN_2022_PROGRAM_ID
        ),
        // Revoke the MintTokens authority from the Owner account
        createSetAuthorityInstruction(
            mint.publicKey,
            payer.publicKey,
            AuthorityType.MintTokens,
            null,
            [],
            TOKEN_2022_PROGRAM_ID
        )
    );

    logger.debug(`Sending transaction to create token ${mint.publicKey.toBase58()}...`);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mint]);

    logger.info(`Transaction to create token ${mint.publicKey.toBase58()} confirmed`);
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=${envVars.RPC_CLUSTER}-alpha`);
    logger.info(
        `${envVars.EXPLORER_URI}/address/${mint.publicKey.toBase58()}?cluster=${envVars.RPC_CLUSTER}-alpha`
    );
}
