import "source-map-support/register";
import dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createLogger } from "./logger";
import { createHeliusClient } from "./helius";
import { createPinataClient } from "./pinata";
import { Pool } from "./pool";
import { createStorage } from "./storage";

dotenv.config();

export enum SwapperType {
    Sniper = "sniper",
    Trader = "trader",
}

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
export const SLIPPAGE = 1;
export const UNKNOWN_KEY = "?".repeat(44);

export const envVars = extractEnvironmentVariables();
export const CLUSTER = detectCluster(envVars.RPC_URIS[0]);
export const ZERO_BN = new BN(0);
export const ZERO_DECIMAL = new Decimal(0);

export const logger = createLogger(envVars.LOG_LEVEL);
export const connectionPool = new Pool(
    envVars.RPC_URIS.map((rpcUri) => new Connection(rpcUri, "confirmed"))
);
export const heliusClientPool = new Pool(
    envVars.RPC_URIS.map((rpcUri) => createHeliusClient(rpcUri))
);
export const pinataClient = createPinataClient(envVars.PINATA_JWT, envVars.IPFS_GATEWAY);

export const encryption = new Encryption("aes-256-cbc", envVars.KEYPAIR_SECRET);
export const explorer = new Explorer(envVars.EXPLORER_URI, CLUSTER);
export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);

function detectCluster(rpcUri: string): "devnet" | "mainnet-beta" {
    if (/devnet/i.test(rpcUri)) {
        return "devnet";
    } else if (/mainnet/i.test(rpcUri)) {
        return "mainnet-beta";
    }

    throw new Error(`Cluster not detected for RPC URI: ${rpcUri}`);
}
