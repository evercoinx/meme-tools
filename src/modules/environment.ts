import { Cluster } from "@solana/web3.js";
import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URI: string;
    CLUSTER: Cluster;
    EXPLORER_URI: string;
    DEV_KEYPAIR_PATH: string;
    KEYRING_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    INITIAL_POOL_SIZE_PERCENT: number;
    INITIAL_POOL_LIQUIDITY_SOL: number;
    HOLDER_SHARE_POOL_PERCENT: number;
    HOLDER_COMPUTE_BUDGET_SOL: number;
    HOLDER_COUNT_PER_POOL: number;
}

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
                .default("https://api.devnet.solana.com")
                .description("Solana RPC URI"),
            CLUSTER: Joi.string()
                .optional()
                .valid("devnet", "testnet", "mainnet-beta")
                .default("devnet")
                .description("Solana cluster"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            DEV_KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(/^\/([\w.-]+\/?)*$/)
                .description("Dev keypair path"),
            KEYRING_SECRET: Joi.string()
                .required()
                .pattern(/^[0-9a-z]{32}$/)
                .description("Keyring secret"),
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
                .min(1e5)
                .max(1e11)
                .default(1e9)
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
            HOLDER_SHARE_POOL_PERCENT: Joi.number()
                .required()
                .min(0.0001)
                .max(1)
                .description("Holder share pool (in percent)"),
            HOLDER_COMPUTE_BUDGET_SOL: Joi.number()
                .required()
                .min(0.0001)
                .max(10)
                .description("Holder compute budget (in SOL)"),
            HOLDER_COUNT_PER_POOL: Joi.number()
                .optional()
                .integer()
                .min(0)
                .max(4)
                .default(4)
                .description("Holder count per pool"),
        })
        .unknown() as Joi.ObjectSchema<EnvironmentSchema>;

    const { value: envVars, error } = envSchema
        .prefs({
            errors: {
                label: "key",
            },
        })
        .validate(process.env);
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
