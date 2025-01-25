import dotenv from "dotenv";
import { extractEnvironmentVariables } from "./environment";
import { createLogger } from "./logger";
import { createCache } from "./cache";
import { createIPFS } from "./ipfs";

const isCI = !!process.env.CI;
dotenv.config({
    path: isCI ? ".env.example" : ".env",
});

export const CACHE_DIR = `${__dirname}/../cache`;
export const IMAGE_DIR = `${__dirname}/../image`;
export const METADATA_DIR = `${__dirname}/../metadata`;

export const envVars = extractEnvironmentVariables();
export const logger = createLogger(envVars.LOG_LEVEL);
export const cache = createCache(CACHE_DIR);
export const ipfs = createIPFS(envVars.IPFS_JWT, envVars.IPFS_GATEWAY);
