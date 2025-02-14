import "source-map-support/register";
import dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createLogger } from "./logger";
import { createHeliusClient, HeliusClient } from "./helius";
import { createPinataClient } from "./pinata";
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
export const UNKNOWN_KEY = "?".repeat(44);

export const envVars = extractEnvironmentVariables();
export const STORAGE_SNIPER_SECRET_KEYS = generateSecretKeyRecord(
    envVars.SNIPER_SHARE_POOL_PERCENTS.length,
    SwapperType.Sniper
);
export const STORAGE_TRADER_SECRET_KEYS = generateSecretKeyRecord(
    envVars.TRADER_COUNT,
    SwapperType.Trader
);
export const CLUSTER = detectCluster(envVars.RPC_URIS[0]);
export const ZERO_BN = new BN(0);
export const ZERO_DECIMAL = new Decimal(0);

export const logger = createLogger(envVars.LOG_LEVEL);
export const connectionPool = createConnectionPool(envVars.RPC_URIS);
export const heliusClientPool = createHeliusClientPool(envVars.RPC_URIS);
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

function generateSecretKeyRecord(
    secretKeyCount: number,
    swapperType: SwapperType
): Record<number, string> {
    const secretKeyRecord: Record<number, string> = {};
    for (let i = 0; i < secretKeyCount; i++) {
        secretKeyRecord[i] = `${swapperType}_${i}_secret_key`;
    }
    return secretKeyRecord;
}

function createConnectionPool(rpcUris: string[]) {
    const connectionPool: Connection[] = [];
    for (const [i, rpcUri] of rpcUris.entries()) {
        connectionPool[i] = new Connection(rpcUri, "confirmed");
    }
    return connectionPool;
}

function createHeliusClientPool(rpcUris: string[]): HeliusClient[] {
    const heliusClientPool: HeliusClient[] = [];
    for (const [i, rpcUri] of rpcUris.entries()) {
        heliusClientPool[i] = createHeliusClient(rpcUri);
    }
    return heliusClientPool;
}
