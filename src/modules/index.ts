import "source-map-support/register";
import dotenv from "dotenv";
import { CREATE_CPMM_POOL_PROGRAM, DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { Connection } from "@solana/web3.js";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createIPFS } from "./ipfs";
import { createLogger } from "./logger";
import { PrioritizationFees } from "./prioritization-fees";
import { createStorage } from "./storage";

dotenv.config();

const cwd = process.cwd();
export const IMAGE_DIR = `${cwd}/input/images`;
export const METADATA_DIR = `${cwd}/input/metadata`;
export const STORAGE_DIR = `${cwd}/storage`;

export const STORAGE_MINT_IMAGE_URI = "mint_image_uri";
export const STORAGE_MINT_METADATA = "mint_metadata";
export const STORAGE_MINT_SECRET_KEY = "mint_secret_key";
export const STORAGE_RAYDIUM_LP_MINT = "raydium_lp_mint";
export const STORAGE_RAYDIUM_POOL_ID = "raydium_pool_id";

export const MIN_REMAINING_BALANCE_LAMPORTS = 5_000;
export const RAYDIUM_LP_MINT_DECIMALS = 9;
export const UNKNOWN_KEY = "?".repeat(44);

export const envVars = extractEnvironmentVariables();
export const STORAGE_SNIPER_SECRET_KEYS: Record<number, string> = [
    ...Array(envVars.SNIPER_SHARE_POOL_PERCENTS.length),
].reduce((secretKeys, _, i) => {
    secretKeys[i] = `sniper_${i}_secret_key`;
    return secretKeys;
}, {});
export const CLUSTER = detectCluster(envVars.RPC_URI);

export const logger = createLogger(envVars.LOG_LEVEL);
export const connection = new Connection(envVars.RPC_URI, "confirmed");
export const encryption = new Encryption("aes-256-cbc", envVars.KEYPAIR_SECRET);
export const explorer = new Explorer(envVars.EXPLORER_URI, CLUSTER);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);
export const prioritizationFees = new PrioritizationFees([
    CLUSTER === "devnet" ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM : CREATE_CPMM_POOL_PROGRAM,
]);
export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);

function detectCluster(rpcUri: string): "devnet" | "mainnet-beta" {
    if (/devnet/i.test(rpcUri)) {
        return "devnet";
    } else if (/mainnet/i.test(rpcUri)) {
        return "mainnet-beta";
    }

    throw new Error(`Cluster not detected for RPC URI: ${rpcUri}`);
}
