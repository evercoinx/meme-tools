import * as fs from "node:fs/promises";
import * as dotenv from "dotenv";
import { createFungible, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
    createTokenIfMissing,
    findAssociatedTokenPda,
    getSplAssociatedTokenProgramId,
    mintTokensTo,
} from "@metaplex-foundation/mpl-toolbox";
import {
    createSignerFromKeypair,
    generateSigner,
    percentAmount,
    createGenericFile,
    signerIdentity,
    Umi,
    KeypairSigner,
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
    image: string;
}

const isCI = !!process.env.CI;
dotenv.config({
    path: isCI ? ".env.example" : ".env",
});

const cacheDir = `${__dirname}/../cache`;
const dataDir = `${__dirname}/../data`;
const explorerUri = "https://explorer.solana.com";

const envVars = extractEnvironmentVariables();
const logger = createLogger(envVars.LOG_LEVEL);
const cache = createCache(cacheDir);

(async () => {
    const umi = createUmi(envVars.RPC_URL).use(mplTokenMetadata()).use(irysUploader());

    const signer = await importSigner(umi);
    umi.use(signerIdentity(signer));

    const imageUri = await uploadImage(umi);
    const metadata = await uploadMetadata(umi, imageUri);

    const mintSigner = generateSigner(umi);
    logger.info(`Mint ${mintSigner.publicKey} created`);

    await sendTransaction(umi, metadata, mintSigner);
})();

async function sendTransaction(
    umi: Umi,
    metadata: Metadata,
    mintSigner: KeypairSigner
): Promise<void> {
    const createFungibleIx = createFungible(umi, {
        mint: mintSigner,
        name: metadata.name,
        uri: metadata.image,
        sellerFeeBasisPoints: percentAmount(0),
        decimals: 9,
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
        amount: 1_000_000_000n,
    });

    logger.debug("Sending transaction...");
    const tx = await createFungibleIx.add(createTokenIx).add(mintTokensIx).sendAndConfirm(umi);

    const signature = base58.deserialize(tx.signature)[0];

    logger.info("Transaction confirmed");
    logger.info(`${explorerUri}/tx/${signature}?cluster=devnet`);
    logger.info(`${explorerUri}/address/${mintSigner.publicKey}?cluster=devnet`);
}

async function importSigner(umi: Umi): Promise<KeypairSigner> {
    const walletFile: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(walletFile));

    const signer = createSignerFromKeypair(umi, keypair);
    logger.info(`Signer ${signer.publicKey} imported`);
    return signer;
}

async function uploadImage(umi: Umi): Promise<string> {
    let imageUri = cache.get<string>("imageUri");
    if (imageUri) {
        logger.info(`Image loaded from cache`);
        return imageUri;
    }

    logger.debug(`Uploading image to Arweave...`);
    const imageFile = await fs.readFile(`${dataDir}/image.webp`);
    const umiImageFile = createGenericFile(imageFile, "image.webp", {
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

async function uploadMetadata(umi: Umi, imageUri: string): Promise<Metadata> {
    let metadata = cache.get<Metadata>("metadata");
    if (metadata) {
        logger.info(`Metadata loaded from cache`);
        return metadata;
    }

    logger.debug(`Uploading metadata to Arweave...`);
    metadata = JSON.parse(await fs.readFile(`${dataDir}/metadata.json`, "utf-8"));
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
