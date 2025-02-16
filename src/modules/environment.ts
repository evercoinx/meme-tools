import Decimal from "decimal.js";
import Joi from "joi";

interface EnvironmentSchema {
    LOG_LEVEL: string;
    PINATA_JWT: string;
    IPFS_GATEWAY: string;
    RPC_URIS: string[];
    EXPLORER_URI: string;
    DEV_KEYPAIR_PATH: string;
    DISTRIBUTOR_KEYPAIR_PATH: string;
    KEYPAIR_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    POOL_SIZE_PERCENT: number;
    POOL_LIQUIDITY_SOL: number;
    SNIPER_SHARE_POOL_PERCENTS: number[];
    SWAPPER_MIN_BALANCE_SOL: number;
    TRADER_COUNT: number;
    TRADER_GROUP_SIZE: number;
    TRADER_BUY_AMOUNT_RANGE_SOL: [number, number];
    TRADER_SELL_AMOUNT_RANGE_PERCENT: [number, number];
    TRADER_SWAP_DELAY_RANGE_SEC: [number, number];
}

const FILE_PATH_PATTERN = /^\/([\w.-]+\/?)*$/;
const ARRAY_SEPARATOR = ",";

const convertToPercent = (value: string) => new Decimal(value).div(100).toDP(4).toNumber();
const convertToMilliseconds = (value: string) => new Decimal(value).mul(1_000).round().toNumber();

export function extractEnvironmentVariables(): EnvironmentSchema {
    const envSchema = Joi.object()
        .keys({
            LOG_LEVEL: Joi.string()
                .optional()
                .valid("debug", "info", "warn", "error", "fatal")
                .default("info"),
            PINATA_JWT: Joi.string()
                .required()
                .pattern(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/)
                .description("Pinata JWT"),
            IPFS_GATEWAY: Joi.string().required().uri().description("IPFS Gateway"),
            RPC_URIS: Joi.array()
                .required()
                .items(Joi.string().uri())
                .unique()
                .min(1)
                .max(3)
                .description("Solana RPC URIs"),
            EXPLORER_URI: Joi.string()
                .optional()
                .uri()
                .default("https://solana.fm")
                .description("Solana explorer URI"),
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
            POOL_SIZE_PERCENT: Joi.number()
                .required()
                .min(10)
                .max(100)
                .custom(convertToPercent)
                .description("Pool size (in percent)"),
            POOL_LIQUIDITY_SOL: Joi.number()
                .required()
                .min(0.01)
                .max(20)
                .description("Pool liquidity (in SOL)"),
            SNIPER_SHARE_POOL_PERCENTS: Joi.array()
                .required()
                .items(Joi.number().min(0.5).max(3).custom(convertToPercent))
                .unique()
                .min(1)
                .max(100)
                .description("Sniper share pool (in percents)"),
            SWAPPER_MIN_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Swapper minimal balance (in SOL)"),
            TRADER_COUNT: Joi.number()
                .required()
                .integer()
                .min(1)
                .max(1_000)
                .description("Trader count"),
            TRADER_GROUP_SIZE: Joi.number()
                .optional()
                .integer()
                .min(1)
                .max(3)
                .default(1)
                .description("Trader group size"),
            TRADER_BUY_AMOUNT_RANGE_SOL: Joi.array()
                .required()
                .items(Joi.number().min(0.001).max(0.1))
                .unique()
                .min(2)
                .max(2)
                .description("Trader buy amount range (in SOL)"),
            TRADER_SELL_AMOUNT_RANGE_PERCENT: Joi.array()
                .required()
                .items(Joi.number().min(1).max(100).custom(convertToPercent))
                .unique()
                .min(2)
                .max(2)
                .description("Trader sell amount range (in percent)"),
            TRADER_SWAP_DELAY_RANGE_SEC: Joi.array()
                .required()
                .items(Joi.number().min(1).max(600).custom(convertToMilliseconds))
                .unique()
                .min(2)
                .max(2)
                .description("Trader swap delay range (in seconds)"),
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
            RPC_URIS: process.env.RPC_URIS?.split(ARRAY_SEPARATOR),
            SNIPER_SHARE_POOL_PERCENTS:
                process.env.SNIPER_SHARE_POOL_PERCENTS?.split(ARRAY_SEPARATOR),
            PRIORITIZATION_FEE_MULTIPLIERS:
                process.env.PRIORITIZATION_FEE_MULTIPLIERS?.split(ARRAY_SEPARATOR),
            TRADER_BUY_AMOUNT_RANGE_SOL:
                process.env.TRADER_BUY_AMOUNT_RANGE_SOL?.split(ARRAY_SEPARATOR),
            TRADER_SELL_AMOUNT_RANGE_PERCENT:
                process.env.TRADER_SELL_AMOUNT_RANGE_PERCENT?.split(ARRAY_SEPARATOR),
            TRADER_SWAP_DELAY_RANGE_SEC:
                process.env.TRADER_SWAP_DELAY_RANGE_SEC?.split(ARRAY_SEPARATOR),
        });
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
