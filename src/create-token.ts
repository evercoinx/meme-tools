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
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import { createInitializeInstruction, pack, TokenMetadata } from "@solana/spl-token-metadata";
import { cache, envVars, IMAGE_DIR, ipfs, METADATA_DIR, logger } from "./common";

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

(async () => {
    try {
        const connection = new Connection(envVars.RPC_URI, "confirmed");
        const [payer, mint] = await generateKeypairs(connection);

        const imageUri = await uploadImage();
        const metadata = await uploadMetadata(imageUri);

        await sendTransaction(connection, metadata, payer, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function generateKeypairs(connection: Connection): Promise<[Keypair, Keypair]> {
    const secretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    const balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
        await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    }
    logger.info(`Payer ${payer.publicKey.toBase58()} imported`);

    const mint = Keypair.generate();
    logger.info(`Mint ${mint.publicKey.toBase58()} generated`);
    cache.set("mint", Buffer.from(mint.secretKey).toString("utf-8"));
    cache.save();
    logger.debug(`Mint ${mint.publicKey.toBase58()} saved to cache`);

    return [payer, mint];
}

async function uploadImage(): Promise<string> {
    let imageUri = cache.get<string>("imageUri");
    if (imageUri) {
        logger.info("Image loaded from cache");
        return imageUri;
    }

    logger.debug("Uploading image to IPFS...");
    const imageFileName = `${envVars.TOKEN_SYMBOL}.webp`;
    const imageBlob = new Blob([await fs.readFile(path.join(IMAGE_DIR, imageFileName))]);

    const imageFile = new File([imageBlob], imageFileName, { type: "image/webp" });
    const upload = await ipfs.upload.file(imageFile);

    imageUri = generateIpfsUri(upload.IpfsHash);
    logger.info(`Image uploaded to IPFS at ${imageUri}`);

    cache.set("imageUri", imageUri);
    cache.save();
    logger.debug(`Image URI saved to cache`);

    return imageUri;
}

async function uploadMetadata(imageUri: string): Promise<OffchainTokenMetadata> {
    let metadata = cache.get<OffchainTokenMetadata>("metadata");
    if (metadata) {
        logger.info(`Metadata loaded from cache`);
        return metadata;
    }

    logger.debug(`Uploading metadata to IPFS...`);
    const metadataFilename = `${envVars.TOKEN_SYMBOL}.json`;
    metadata = {
        ...JSON.parse(await fs.readFile(path.join(METADATA_DIR, metadataFilename), "utf-8")),
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

    cache.set("metadata", metadata);
    cache.save();
    logger.debug(`Metadata saved to cache`);

    return metadata;
}

async function sendTransaction(
    connection: Connection,
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
    const metadataDataExtensionSize = TYPE_SIZE + LENGTH_SIZE;
    // Size of metadata
    const metadataSize = pack(metadata).length;
    // Minimum lamports required for Mint account
    const mintLamports = await connection.getMinimumBalanceForRentExemption(
        mintSize + metadataDataExtensionSize + metadataSize
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

    logger.debug("Sending transaction...");
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mint]);

    logger.info("Transaction confirmed");
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=devnet-alpha`);
    logger.info(
        `${envVars.EXPLORER_URI}/address/${mint.publicKey.toBase58()}?cluster=devnet-alpha`
    );
}
