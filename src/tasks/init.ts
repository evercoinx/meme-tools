import "source-map-support/register";
import dotenv from "dotenv";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Encryption } from "../modules/encryption";
import { extractEnvironmentVariables } from "../modules/environment";
import { createIPFS } from "../modules/ipfs";
import { createLogger } from "../modules/logger";
import { createCache, createKeyring } from "../modules/storage";

dotenv.config();

const cwd = process.cwd();
export const IMAGE_DIR = `${cwd}/input/images`;
export const METADATA_DIR = `${cwd}/input/metadata`;
export const STORAGE_DIR = `${cwd}/storage`;

export const CACHE_KEY_METADATA = "metadata";
export const CACHE_KEY_IMAGE_URI = "image_uri";
export const KEYRING_KEY_MINT = "mint";

export const envVars = extractEnvironmentVariables();
export const logger = createLogger(envVars.LOG_LEVEL);
export const connection = new Connection(envVars.RPC_URI, "confirmed");
export const encryption = new Encryption("aes-256-cbc", envVars.KEYRING_SECRET_KEY);
export const cache = createCache(STORAGE_DIR);
export const keyring = createKeyring(STORAGE_DIR);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);

export function lamportsToSol(amount: bigint | number, decimals = 3) {
    if (amount > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Too high amount for representation: ${amount}`);
    }

    const solAmount = Number(amount) / LAMPORTS_PER_SOL;
    return solAmount.toFixed(decimals);
}
