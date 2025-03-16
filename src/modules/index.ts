import { homedir } from "node:os";
import { join, parse } from "node:path";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { TRANSACTION_CONFIRMATION_TIMEOUT_MS } from "../helpers/network";
import { Encryption } from "./encryption";
import { extractEnvironmentVariables } from "./environment";
import { Explorer } from "./explorer";
import { createLogger } from "./logger";
import { createHeliusClient } from "./helius";
import { createPinataClient } from "./pinata";
import { Pool } from "./pool";
import { RandomSeed } from "./random-seed";
import { createStorage } from "./storage";

export const SWAPPER_SLIPPAGE_PERCENT = 1;
export const ZERO_BN = new BN(0);
export const ZERO_DECIMAL = new Decimal(0);

export const envVars = extractEnvironmentVariables();
export const TOKEN_IMAGE_FILE_NAME = `${envVars.TOKEN_SYMBOL.toLowerCase()}.webp`;
export const UNITS_PER_MINT = 10 ** envVars.TOKEN_DECIMALS;
export const MINT_DUST_UNITS = new Decimal(100).mul(UNITS_PER_MINT);

const currentWorkingDir = process.cwd();
export const IMAGE_DIR = join(currentWorkingDir, "images", envVars.NODE_ENV);
export const LOG_DIR = join(currentWorkingDir, "logs", envVars.NODE_ENV);
export const STORAGE_DIR = join(currentWorkingDir, "storages", envVars.NODE_ENV);

const homeDir = homedir();
export const KEYPAIR_DIR = join(
    homeDir,
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
                commitment: "confirmed",
                confirmTransactionInitialTimeout: TRANSACTION_CONFIRMATION_TIMEOUT_MS,
                disableRetryOnRateLimit: true,
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

export const randomSeed = new RandomSeed(
    `${envVars.NODE_ENV}:${envVars.TOKEN_SYMBOL}:${envVars.TRADER_COUNT}`
);

export const storage = createStorage(STORAGE_DIR, envVars.TOKEN_SYMBOL);
