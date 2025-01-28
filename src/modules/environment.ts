import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URI: string;
    RPC_CLUSTER: "devnet" | "testnet" | "mainnet";
    EXPLORER_URI: string;
    KEYPAIR_PATH: string;
    KEYRING_SECRET_KEY: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    TOKEN_POOL_SIZE_PERCENT: number;
    TOKEN_POOL_SOL_AMOUNT: number;
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
            RPC_CLUSTER: Joi.string()
                .optional()
                .valid("devnet", "testnet", "mainnet")
                .default("devnet")
                .description("Solana RPC cluster"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(/^\/([\w.-]+\/?)*$/)
                .description("Keypair path for payer"),
            KEYRING_SECRET_KEY: Joi.string()
                .required()
                .pattern(/^[0-9a-z]{32}$/)
                .description("Keyring secret key"),
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
            TOKEN_POOL_SIZE_PERCENT: Joi.number()
                .required()
                .min(0.0001)
                .max(1)
                .description("Token pool size percent"),
            TOKEN_POOL_SOL_AMOUNT: Joi.number()
                .required()
                .min(0.01)
                .max(20)
                .description("SOL amount for token pool"),
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
