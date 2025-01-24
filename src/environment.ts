import * as Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    IPFS_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URL: string;
    KEYPAIR_PATH: string;
    TOKEN_SYMBOL: string;
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
            RPC_URL: Joi.string().required().uri().description("RPC URL"),
            KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(/^\/([\w.-]+\/?)*$/)
                .description("Keypair path"),
            TOKEN_SYMBOL: Joi.string().required().uppercase(),
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
