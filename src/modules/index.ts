import "source-map-support/register";
import dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createIPFS } from "./ipfs";
import { createLogger } from "./logger";
import { createStorage } from "./storage";

dotenv.config();

const cwd = process.cwd();
export const IMAGE_DIR = `${cwd}/input/images`;
export const METADATA_DIR = `${cwd}/input/metadata`;
export const STORAGE_DIR = `${cwd}/storage`;

export const STORAGE_METADATA = "metadata";
export const STORAGE_IMAGE_URI = "image_uri";
export const STORAGE_MINT_SECRET_KEY = "mint_secret_key";
export const STORAGE_HOLDER_SECRET_KEYS: Record<number, string> = {
    0: "holder_0_secret_key",
    1: "holder_1_secret_key",
    2: "holder_2_secret_key",
    3: "holder_3_secret_key",
};
export const STORAGE_RAYDIUM_POOL_ID = "raydium_pool_id";
export const STORAGE_RAYDIUM_LP_MINT = "raydium_lp_mint";

export const RAYDIUM_LP_MINT_DECIMALS = 9;

export const envVars = extractEnvironmentVariables();
export const logger = createLogger(envVars.LOG_LEVEL);
export const connection = new Connection(envVars.RPC_URI, "confirmed");
export const encryption = new Encryption("aes-256-cbc", envVars.KEYRING_SECRET);
export const explorer = new Explorer(envVars.EXPLORER_URI, envVars.CLUSTER);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);
export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);
