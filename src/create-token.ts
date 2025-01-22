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
    sol,
    Umi,
    KeypairSigner,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { extractEnvironmentVariables } from "./environment";
import { createLogger } from "./logger";

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

const envVars = extractEnvironmentVariables();
const logger = createLogger(envVars.LOG_LEVEL);
const dataDir = `${__dirname}/../data`;

(async () => {
    const umi = createUmi(envVars.RPC_URL).use(mplTokenMetadata()).use(irysUploader());

    const signer = await importSigner(umi);
    umi.use(signerIdentity(signer));

    const imageUri = await uploadImage(umi);

    await uploadMetadata(umi, imageUri);

    const mintSigner = generateSigner(umi);
    logger.info(`Mint ${mintSigner.publicKey} created`);
})();

async function importSigner(umi: Umi): Promise<KeypairSigner> {
    const walletFile: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf-8"));
    const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(walletFile));

    const signer = createSignerFromKeypair(umi, keypair);
    logger.info(`Signer ${signer.publicKey} imported`);
    return signer;
}

async function uploadImage(umi: Umi): Promise<string> {
    logger.debug(`Uploading image to Arweave...`);

    const imageFile = await fs.readFile(`${dataDir}/image.webp`);
    const umiImageFile = createGenericFile(imageFile, "image.webp", {
        tags: [{ name: "Content-Type", value: "image/webp" }],
    });

    const imageUris = await umi.uploader.upload([umiImageFile]).catch((err) => {
        throw new Error(err);
    });
    logger.info(`Image uploaded to Arweave at ${imageUris}`);
    return imageUris[0];
}

async function uploadMetadata(umi: Umi, imageUri: string): Promise<void> {
    logger.debug(`Uploading metadata to Arweave...`);
    const metadata: Metadata = JSON.parse(await fs.readFile(`${dataDir}/metadata.json`, "utf-8"));
    metadata.image = imageUri;

    const metadataUri = await umi.uploader.uploadJson(metadata).catch((err) => {
        throw new Error(err);
    });
    logger.info(`Metadata uploaded to Arweave at ${metadataUri}`);
}
