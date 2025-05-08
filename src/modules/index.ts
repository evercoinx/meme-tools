import { Agent } from "node:https";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { formatInteger, formatMilliseconds, formatUri } from "../helpers/format";
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

export const tokenSeed = new Seed(process.env.NODE_ENV, process.env.TOKEN_SYMBOL);
export const timeSeed = new Seed(
    process.env.NODE_ENV,
    process.env.TOKEN_SYMBOL,
    Date.now().toString()
);

export const envVars = extractEnvironmentVariables(tokenSeed);
export const UNITS_PER_MINT = 10 ** envVars.TOKEN_DECIMALS;
export const MINT_DUST_UNITS = new Decimal(100).mul(UNITS_PER_MINT);
export const MINT_IMAGE_TYPE = "jpg";
export const MINT_IMAGE_FILE_NAME = `${envVars.TOKEN_SYMBOL.toLowerCase()}.${MINT_IMAGE_TYPE}`;
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = 60_000;
export const DISTRIBUTOR_BALANCE_SOL = Math.max(
    envVars.SNIPER_BALANCE_SOL,
    envVars.TRADER_BALANCE_SOL,
    envVars.WHALE_BALANCE_SOL
);

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
    tokenSeed,
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
                disableRetryOnRateLimit: true,
                fetch: fetchUri,
            })
    )
);
export const heliusClientPool = new Pool(
    tokenSeed,
    Array.from(envVars.RPC_URIS).map((rpcUri) => createHeliusClient(rpcUri, envVars.RPC_CLUSTER))
);

export const explorer = new Explorer(envVars.EXPLORER_URI, envVars.RPC_CLUSTER);
export const pinataClient = createPinataClient(envVars.PINATA_JWT, envVars.IPFS_GATEWAY_URI);
export const pythClient = new Pyth(connectionPool, envVars.RPC_CLUSTER);

export const encryption = new Encryption(
    "aes-256-cbc",
    envVars.KEYPAIR_ENCRYPTION_SECRET,
    "encrypted"
);
export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);

const MAX_FETCH_ATTEMTPS = 5;
const BASE_BACKOFF_PERIOD_MS = 1_000;
const MAX_BACKOFF_PERIOD_MS = 8_000;

async function fetchUri(
    uri: string | URL | Request,
    options?: RequestInit,
    timeout = TRANSACTION_CONFIRMATION_TIMEOUT_MS
): Promise<Response> {
    for (let i = 1; i <= MAX_FETCH_ATTEMTPS; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(uri, {
                ...options,
                signal: controller.signal,
            });
            if (response.ok) {
                return response;
            }

            logger.warn(
                "Attempt: %s. Fetch failed with status %s for %s",
                formatInteger(i),
                formatInteger(response.status),
                formatUri(uri)
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.name === "AbortError") {
                logger.warn(
                    "Attempt: %s. Fetch timeout after %s for %s",
                    formatInteger(i),
                    formatMilliseconds(timeout),
                    formatUri(uri)
                );
            } else {
                logger.warn(
                    "Attempt: %s. Fetch failed for %s. Reason: %s",
                    formatInteger(i),
                    formatUri(uri),
                    error instanceof Error ? error.message : String(error)
                );
            }
        } finally {
            clearTimeout(timeoutId);
        }

        const backoff = Math.min(BASE_BACKOFF_PERIOD_MS * 2 ** (i - 1), MAX_BACKOFF_PERIOD_MS);
        logger.warn("Refetching in %s sec", formatMilliseconds(backoff));
        await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    throw new Error(
        `Unable to fetch ${formatUri(uri)} after ${formatInteger(MAX_FETCH_ATTEMTPS)} attempts`
    );
}
