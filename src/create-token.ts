import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddress,
    getMinimumBalanceForRentExemptMint,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import { extractEnvironmentVariables } from "./environment";
import { createLogger } from "./logger";
import { createCache } from "./cache";
import { createIPFS } from "./ipfs";

interface Metadata {
    name: string;
    symbol: string;
    description: string;
}

interface ExtendedMetadata extends Metadata {
    image: string;
    uri: string;
}

const isCI = !!process.env.CI;
dotenv.config({
    path: isCI ? ".env.example" : ".env",
});

const CACHE_DIR = `${__dirname}/../cache`;
const IMAGE_DIR = `${__dirname}/../image`;
const METADATA_DIR = `${__dirname}/../metadata`;
const EXPLORER_URI = "https://explorer.solana.com";

const TOKEN_DATA = {
    decimals: 9,
    supply: 1_000_000_000 * LAMPORTS_PER_SOL,
};

const envVars = extractEnvironmentVariables();
const logger = createLogger(envVars.LOG_LEVEL);
const cache = createCache(CACHE_DIR);
const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);

(async () => {
    try {
        const payer = await importPayer();

        const imageUri = await uploadImage();
        const metadata = await uploadMetadata(imageUri);

        const mint = Keypair.generate();
        logger.info(`Mint ${mint.publicKey.toBase58()} created`);

        const connection = new Connection(envVars.RPC_URL, "confirmed");

        await sendTransaction(connection, metadata, payer, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function importPayer(): Promise<Keypair> {
    const secretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    logger.info(`Payer ${payerKeypair.publicKey.toBase58()} imported`);
    return payerKeypair;
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

    imageUri = `${envVars.IPFS_GATEWAY}/${upload.IpfsHash}`;
    logger.info(`Image uploaded to IPFS at ${imageUri}`);

    cache.set("imageUri", imageUri);
    cache.save();
    logger.debug(`Image URI saved to cache`);

    return imageUri;
}

async function uploadMetadata(imageUri: string): Promise<ExtendedMetadata> {
    let metadata = cache.get<ExtendedMetadata>("metadata");
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

    const metadataUri = `${envVars.IPFS_GATEWAY}/${upload.IpfsHash}`;
    metadata = { ...metadata, uri: metadataUri };
    logger.info(`Metadata uploaded to IPFS at ${metadataUri}`);

    cache.set("metadata", metadata);
    cache.save();
    logger.debug(`Metadata saved to cache`);

    return metadata;
}

async function sendTransaction(
    connection: Connection,
    metadata: ExtendedMetadata,
    payer: Keypair,
    mint: Keypair
): Promise<void> {
    const mintRentLamports = await getMinimumBalanceForRentExemptMint(connection);
    const transaction = new Transaction();

    const associatedToken = await getAssociatedTokenAddress(
        mint.publicKey,
        payer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    transaction.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            lamports: mintRentLamports,
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
            mint.publicKey,
            TOKEN_DATA.decimals,
            payer.publicKey,
            null,
            TOKEN_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            associatedToken,
            payer.publicKey,
            mint.publicKey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
            mint.publicKey,
            associatedToken,
            payer.publicKey,
            TOKEN_DATA.supply,
            [],
            TOKEN_PROGRAM_ID
        )
    );

    logger.debug("Sending transaction...");
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mint]);

    logger.info("Transaction confirmed");
    logger.info(`${EXPLORER_URI}/tx/${signature}?cluster=devnet`);
    logger.info(`${EXPLORER_URI}/address/${mint.publicKey.toBase58()}?cluster=devnet`);
}
