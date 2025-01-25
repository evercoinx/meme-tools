import dotenv from "dotenv";
import { extractEnvironmentVariables } from "./environment";
import { createLogger } from "./logger";
import { createCache, createKeyring } from "./storage";
import { Encryption } from "./encryption";
import { createIPFS } from "./ipfs";

dotenv.config();

export const IMAGE_DIR = `${__dirname}/../input/image`;
export const METADATA_DIR = `${__dirname}/../input/metadata`;
export const STORAGE_DIR = `${__dirname}/../storage`;

export const CACHE_KEY_METADATA = "metadata";
export const CACHE_KEY_IMAGE_URI = "image_uri";
export const KEYRING_KEY_MINT = "mint";

export const envVars = extractEnvironmentVariables();
export const encryption = new Encryption("aes-256-cbc", envVars.KEYRING_SECRET_KEY);
export const logger = createLogger(envVars.LOG_LEVEL);
export const cache = createCache(STORAGE_DIR);
export const keyring = createKeyring(STORAGE_DIR);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);
