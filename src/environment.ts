import * as Joi from "joi";

interface EnvironmentSchema {
    RPC_URL: string;
    KEYPAIR_PATH: string;
}

export function extractEnvironmentVariables(): EnvironmentSchema {
    const envSchema = Joi.object()
        .keys({
            RPC_URL: Joi.string().required().uri().description("RPC URL"),
            KEYPAIR_PATH: Joi.string()
                .required()
                .pattern(/^\/([\w.-]+\/?)*$/)
                .description("Keypair path"),
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
