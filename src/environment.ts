import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URI: string;
    EXPLORER_URI: string;
    KEYPAIR_PATH: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
}

export function extractEnvironmentVariables(): EnvironmentSchema {
    const envSchema = Joi.object()
        .keys({
            LOG_LEVEL: Joi.string()
                .optional()
                .valid("debug", "info", "warn", "error", "fatal")
                .default("info"),
            IPFS_JWT: Joi.string().required().description("IPFS JWT"),
            IPFS_GATEWAY: Joi.string().required().uri().description("IPFS Gateway"),
            RPC_URI: Joi.string()
                .optional()
                .uri()
                .default("https://api.devnet.solana.com")
                .description("Solana RPC URI"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(/^\/([\w.-]+\/?)*$/)
                .description("Keypair path for payer"),
            TOKEN_SYMBOL: Joi.string().required().uppercase().max(20).description("Token symbol"),
            TOKEN_DECIMALS: Joi.number()
                .optional()
                .min(0)
                .max(9)
                .default(9)
                .description("Token decimals"),
            TOKEN_SUPPLY: Joi.number()
                .optional()
                .min(1e5)
                .max(1e11)
                .default(1e9)
                .description("Token supply"),
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
