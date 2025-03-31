import { Agent } from "node:https";
import { homedir } from "node:os";
import { join, parse } from "node:path";
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
import { Pyth } from "./pyth";
import { Seed } from "./seed";
import { createStorage } from "./storage";

export const SWAPPER_SLIPPAGE_PERCENT = 1;
export const ZERO_BN = new BN(0);
export const ZERO_DECIMAL = new Decimal(0);

export const envVars = extractEnvironmentVariables();
export const UNITS_PER_MINT = 10 ** envVars.TOKEN_DECIMALS;
export const MINT_DUST_UNITS = new Decimal(100).mul(UNITS_PER_MINT);
export const MINT_IMAGE_TYPE = "webp";
export const MINT_IMAGE_FILE_NAME = `${envVars.TOKEN_SYMBOL.toLowerCase()}.${MINT_IMAGE_TYPE}`;
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = 60_000;

const currentWorkingDir = process.cwd();
export const IMAGE_DIR = join(currentWorkingDir, "images", envVars.NODE_ENV);
export const LOG_DIR = join(currentWorkingDir, "logs", envVars.NODE_ENV);
export const STORAGE_DIR = join(currentWorkingDir, "storages", envVars.NODE_ENV);

export const KEYPAIR_DIR = join(
    homedir(),
    ".config",
    "solana",
    envVars.NODE_ENV,
    envVars.TOKEN_SYMBOL.toLowerCase()
);

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
                httpAgent: new Agent({
                    keepAlive: true,
                    keepAliveMsecs: TRANSACTION_CONFIRMATION_TIMEOUT_MS,
                    maxSockets: 256,
                    maxFreeSockets: 32,
                }),
                commitment: "confirmed",
                confirmTransactionInitialTimeout: TRANSACTION_CONFIRMATION_TIMEOUT_MS,
                disableRetryOnRateLimit: false,
                fetch: async (
                    url: string | URL | Request,
                    options?: RequestInit,
                    timeout = TRANSACTION_CONFIRMATION_TIMEOUT_MS
                ): Promise<Response> => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    try {
                        const response = await fetch(url, {
                            ...options,
                            signal: controller.signal,
                        });
                        return response;
                    } finally {
                        clearTimeout(timeoutId);
                    }
                },
            })
    )
);

export const heliusClientPool = new Pool(
    Array.from(envVars.RPC_URIS).map((rpcUri) => createHeliusClient(rpcUri, envVars.RPC_CLUSTER))
);

export const encryption = new Encryption(
    "aes-256-cbc",
    envVars.KEYPAIR_ENCRYPTION_SECRET,
    "encrypted"
);

export const explorer = new Explorer(envVars.EXPLORER_URI, envVars.RPC_CLUSTER);

export const pinataClient = createPinataClient(envVars.PINATA_JWT, envVars.IPFS_GATEWAY_URI);

export const pyth = new Pyth(connectionPool, envVars.RPC_CLUSTER);

export const seed = new Seed(
    `${envVars.NODE_ENV}:${envVars.SNIPER_POOL_SHARE_PERCENTS.size}:${envVars.TRADER_COUNT}`
);

export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);
