import { join, parse } from "node:path";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import pc from "picocolors";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createLogger } from "./logger";
import { createHeliusClient } from "./helius";
import { createPinataClient } from "./pinata";
import { Pool } from "./pool";
import { createStorage } from "./storage";

export enum SwapperType {
    Sniper = "sniper",
    Trader = "trader",
}

const cwd = process.cwd();
export const IMAGE_DIR = join(cwd, "input", "images");
export const METADATA_DIR = join(cwd, "input", "metadata");
export const LOG_DIR = join(cwd, "logs");
export const STORAGE_DIR = join(cwd, "storage");

export const STORAGE_MINT_IMAGE_URI = "mint_image_uri";
export const STORAGE_MINT_METADATA = "mint_metadata";
export const STORAGE_MINT_SECRET_KEY = "mint_secret_key";
export const STORAGE_RAYDIUM_LP_MINT = "raydium_lp_mint";
export const STORAGE_RAYDIUM_POOL_ID = "raydium_pool_id";
export const STORAGE_RAYDIUM_POOL_TRADING_CYCLE = "raydium_pool_trading_cycle";

export const MIN_REMAINING_BALANCE_LAMPORTS = 5_000;
export const RAYDIUM_LP_MINT_DECIMALS = 9;
export const SWAP_SLIPPAGE = 1;
export const OUTPUT_SEPARATOR = pc.gray("=".repeat(80));
export const OUTPUT_UNKNOWN_KEY = pc.gray("?".repeat(44));

export const envVars = extractEnvironmentVariables();
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = 60_000;
export const ZERO_BN = new BN(0);
export const ZERO_DECIMAL = new Decimal(0);

export const logger = createLogger(
    envVars.TOKEN_SYMBOL,
    process.argv.length > 1 ? parse(process.argv[1]).name : "",
    envVars.LOG_LEVEL,
    LOG_DIR
);
export const connectionPool = new Pool(
    Array.from(envVars.RPC_URIS).map(
        (rpcUri) =>
            new Connection(rpcUri, {
                commitment: "confirmed",
                confirmTransactionInitialTimeout: TRANSACTION_CONFIRMATION_TIMEOUT_MS,
                disableRetryOnRateLimit: true,
            })
    )
);
export const heliusClientPool = new Pool(
    Array.from(envVars.RPC_URIS).map((rpcUri) => createHeliusClient(rpcUri, envVars.RPC_CLUSTER))
);
export const pinataClient = createPinataClient(envVars.PINATA_JWT, envVars.IPFS_GATEWAY);

export const encryption = new Encryption("aes-256-cbc", envVars.KEYPAIR_SECRET);
export const explorer = new Explorer(envVars.EXPLORER_URI, envVars.RPC_CLUSTER);
export const storage = createStorage(envVars.TOKEN_SYMBOL, STORAGE_DIR);
