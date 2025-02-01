import "source-map-support/register";
import dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { Encryption } from "../modules/encryption";
import { extractEnvironmentVariables } from "../modules/environment";
import { createIPFS } from "../modules/ipfs";
import { createLogger } from "../modules/logger";
import { createStorage } from "../modules/storage";

dotenv.config();

const cwd = process.cwd();
export const IMAGE_DIR = `${cwd}/input/images`;
export const METADATA_DIR = `${cwd}/input/metadata`;
export const STORAGE_DIR = `${cwd}/storage`;

export const STORAGE_METADATA = "metadata";
export const STORAGE_IMAGE_URI = "image_uri";
export const STORAGE_MINT_SECRET_KEY = "mint_secret_key";
export const STORAGE_RAYDIUM_POOL_ID = "raydium_pool_id";

export const envVars = extractEnvironmentVariables();
export const logger = createLogger(envVars.LOG_LEVEL);
export const connection = new Connection(envVars.RPC_URI, "confirmed");
export const encryption = new Encryption("aes-256-cbc", envVars.KEYRING_SECRET);
export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);
