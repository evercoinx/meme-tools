import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { createFungible, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
    createTokenIfMissing,
    findAssociatedTokenPda,
    getSplAssociatedTokenProgramId,
    mintTokensTo,
} from "@metaplex-foundation/mpl-toolbox";
import {
    KeypairSigner,
    Umi,
    createSignerFromKeypair,
    createGenericFile,
    generateSigner,
    percentAmount,
    tokenAmount,
    signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { extractEnvironmentVariables } from "./environment";
import { createLogger } from "./logger";
import { createCache } from "./cache";

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
    supply: tokenAmount(1_000_000_000, undefined, 9),
};

const envVars = extractEnvironmentVariables();
const logger = createLogger(envVars.LOG_LEVEL);
const cache = createCache(CACHE_DIR);

(async () => {
    try {
        const umi = createUmi(envVars.RPC_URL).use(mplTokenMetadata()).use(irysUploader());

        const paySigner = await importPaySigner(umi);
        umi.use(signerIdentity(paySigner));

        const imageUri = await uploadImage(umi);
        const metadata = await uploadMetadata(umi, imageUri);

        const mintSigner = generateSigner(umi);
        logger.info(`Mint signer ${mintSigner.publicKey} created`);

        await sendTransaction(umi, metadata, mintSigner);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function importPaySigner(umi: Umi): Promise<KeypairSigner> {
    const walletFile: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(walletFile));

    const paySigner = createSignerFromKeypair(umi, keypair);
    logger.info(`Pay signer ${paySigner.publicKey} imported`);
    return paySigner;
}

async function uploadImage(umi: Umi): Promise<string> {
    let imageUri = cache.get<string>("imageUri");
    if (imageUri) {
        logger.info(`Image loaded from cache`);
        return imageUri;
    }

    logger.debug(`Uploading image to Arweave...`);
    const imageFileName = `${envVars.TOKEN_SYMBOL}.webp`;
    const imageFile = await fs.readFile(path.join(IMAGE_DIR, imageFileName));
    const umiImageFile = createGenericFile(imageFile, imageFileName, {
        tags: [{ name: "Content-Type", value: "image/webp" }],
    });

    const imageUris = await umi.uploader.upload([umiImageFile]).catch((err) => {
        throw new Error(err);
    });
    logger.info(`Image uploaded to Arweave at ${imageUris}`);

    imageUri = imageUris[0];
    cache.set("imageUri", imageUri);
    cache.save();
    logger.debug(`Image URI saved to cache`);

    return imageUri;
}

async function uploadMetadata(umi: Umi, imageUri: string): Promise<ExtendedMetadata> {
    let metadata = cache.get<ExtendedMetadata>("metadata");
    if (metadata) {
        logger.info(`Metadata loaded from cache`);
        return metadata;
    }

    logger.debug(`Uploading metadata to Arweave...`);
    const metadataFilename = `${envVars.TOKEN_SYMBOL}.json`;
    metadata = JSON.parse(await fs.readFile(path.join(METADATA_DIR, metadataFilename), "utf-8"));
    metadata.image = imageUri;

    const metadataUri = await umi.uploader.uploadJson(metadata).catch((err) => {
        throw new Error(err);
    });
    logger.info(`Metadata uploaded to Arweave at ${metadataUri}`);

    cache.set("metadata", metadata);
    cache.save();
    logger.debug(`Metadata saved to cache`);

    return metadata;
}

async function sendTransaction(
    umi: Umi,
    metadata: ExtendedMetadata,
    mintSigner: KeypairSigner
): Promise<void> {
    const createFungibleIx = createFungible(umi, {
        mint: mintSigner,
        name: metadata.name,
        uri: metadata.uri,
        sellerFeeBasisPoints: percentAmount(0),
        decimals: TOKEN_DATA.decimals,
    });

    const createTokenIx = createTokenIfMissing(umi, {
        mint: mintSigner.publicKey,
        owner: umi.identity.publicKey,
        ataProgram: getSplAssociatedTokenProgramId(umi),
    });

    const mintTokensIx = mintTokensTo(umi, {
        mint: mintSigner.publicKey,
        token: findAssociatedTokenPda(umi, {
            mint: mintSigner.publicKey,
            owner: umi.identity.publicKey,
        }),
        amount: TOKEN_DATA.supply.basisPoints,
    });

    logger.debug("Sending transaction...");
    const tx = await createFungibleIx.add(createTokenIx).add(mintTokensIx).sendAndConfirm(umi);

    const signature = base58.deserialize(tx.signature)[0];

    logger.info("Transaction confirmed");
    logger.info(`${EXPLORER_URI}/tx/${signature}?cluster=devnet`);
    logger.info(`${EXPLORER_URI}/address/${mintSigner.publicKey}?cluster=devnet`);
}
