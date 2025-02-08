import { Cluster, clusterApiUrl } from "@solana/web3.js";
import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URI: string;
    CLUSTER: Cluster;
    EXPLORER_URI: string;
    PRIORITIZATION_FEE_MULTIPLIER: number;
    DEV_KEYPAIR_PATH: string;
    DISTRIBUTOR_KEYPAIR_PATH: string;
    KEYPAIR_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    INITIAL_POOL_SIZE_PERCENT: number;
    INITIAL_POOL_LIQUIDITY_SOL: number;
    HOLDER_SHARE_POOL_PERCENTS: number[];
    HOLDER_COMPUTE_BUDGET_SOL: number;
}

const FILE_PATH_PATTERN = /^\/([\w.-]+\/?)*$/;
const DEFAULT_CLUSTER: Cluster = "devnet";

export function extractEnvironmentVariables(): EnvironmentSchema {
    const envSchema = Joi.object()
        .keys({
            LOG_LEVEL: Joi.string()
                .optional()
                .valid("debug", "info", "warn", "error", "fatal")
                .default("info"),
            IPFS_JWT: Joi.string()
                .required()
                .pattern(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/)
                .description("IPFS JWT"),
            IPFS_GATEWAY: Joi.string().required().uri().description("IPFS Gateway"),
            RPC_URI: Joi.string()
                .optional()
                .uri()
                .default(clusterApiUrl(DEFAULT_CLUSTER))
                .description("Solana RPC URI"),
            CLUSTER: Joi.string()
                .optional()
                .valid("devnet", "testnet", "mainnet-beta")
                .default(DEFAULT_CLUSTER)
                .description("Solana cluster"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            PRIORITIZATION_FEE_MULTIPLIER: Joi.number()
                .optional()
                .min(0.0001)
                .max(10)
                .default(1)
                .description("Prioritization fee multiplier"),
            DEV_KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(FILE_PATH_PATTERN)
                .description("Dev keypair path"),
            DISTRIBUTOR_KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(FILE_PATH_PATTERN)
                .description("Distributor keypair path"),
            KEYPAIR_SECRET: Joi.string()
                .required()
                .pattern(/^[0-9a-z]{32}$/)
                .description("Key pair secret"),
            TOKEN_SYMBOL: Joi.string().required().uppercase().max(20).description("Token symbol"),
            TOKEN_DECIMALS: Joi.number()
                .optional()
                .integer()
                .min(0)
                .max(6)
                .default(6)
                .description("Token decimals"),
            TOKEN_SUPPLY: Joi.number()
                .optional()
                .integer()
                .min(100_000)
                .max(100_000_000_000)
                .default(1_000_000_000)
                .description("Token supply"),
            INITIAL_POOL_SIZE_PERCENT: Joi.number()
                .required()
                .min(0.0001)
                .max(1)
                .description("Initial pool size percent"),
            INITIAL_POOL_LIQUIDITY_SOL: Joi.number()
                .required()
                .min(0.0001)
                .max(10)
                .description("Initial pool liquidity (in SOL)"),
            HOLDER_COMPUTE_BUDGET_SOL: Joi.number()
                .required()
                .min(0.0001)
                .max(10)
                .description("Holder compute budget (in SOL)"),
            HOLDER_SHARE_POOL_PERCENTS: Joi.array()
                .required()
                .items(Joi.number().min(0.001).max(0.1))
                .unique()
                .min(1)
                .max(4)
                .description("Holder share pool (in percents)"),
        })
        .unknown() as Joi.ObjectSchema<EnvironmentSchema>;

    const { value: envVars, error } = envSchema
        .prefs({
            errors: {
                label: "key",
            },
        })
        .validate({
            ...process.env,
            HOLDER_SHARE_POOL_PERCENTS: process.env.HOLDER_SHARE_POOL_PERCENTS?.split(","),
        });
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
