import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URI: string;
    EXPLORER_URI: string;
    PRIORITIZATION_FEE_MULTIPLIERS: number[];
    MAX_TRANSACTION_CONFIRMATION_RETRIES: number;
    DEV_KEYPAIR_PATH: string;
    DISTRIBUTOR_KEYPAIR_PATH: string;
    KEYPAIR_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    INITIAL_POOL_SIZE_PERCENT: number;
    INITIAL_POOL_LIQUIDITY_SOL: number;
    SNIPER_SHARE_POOL_PERCENTS: number[];
    SNIPER_COMPUTE_BUDGET_SOL: number;
}

const FILE_PATH_PATTERN = /^\/([\w.-]+\/?)*$/;

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
            RPC_URI: Joi.string().required().uri().description("Solana RPC URI"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            PRIORITIZATION_FEE_MULTIPLIERS: Joi.array()
                .required()
                .items(Joi.number().min(0.0001).max(10))
                .unique()
                .min(2)
                .max(4)
                .description("Prioritization fee multipliers"),
            MAX_TRANSACTION_CONFIRMATION_RETRIES: Joi.number()
                .optional()
                .integer()
                .min(1)
                .max(10)
                .default(5)
                .description("Maximum transaction confirmation retries"),
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
                .min(0.01)
                .max(10)
                .description("Initial pool liquidity (in SOL)"),
            SNIPER_SHARE_POOL_PERCENTS: Joi.array()
                .required()
                .items(Joi.number().min(0.001).max(0.1))
                .unique()
                .min(1)
                .max(100)
                .description("Sniper share pool (in percents)"),
            SNIPER_COMPUTE_BUDGET_SOL: Joi.number()
                .required()
                .min(0.001)
                .max(1)
                .description("Sniper compute budget (in SOL)"),
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
            SNIPER_SHARE_POOL_PERCENTS: process.env.SNIPER_SHARE_POOL_PERCENTS?.split(","),
            PRIORITIZATION_FEE_MULTIPLIERS: process.env.PRIORITIZATION_FEE_MULTIPLIERS?.split(","),
        });
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
