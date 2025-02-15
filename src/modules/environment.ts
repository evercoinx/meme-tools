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
    INITIAL_POOL_SIZE_PERCENT: number;
    INITIAL_POOL_LIQUIDITY_SOL: number;
    SNIPER_SHARE_POOL_PERCENTS: number[];
    INITIAL_SWAPPER_BALANCE_SOL: number;
    TRADER_COUNT: number;
    TRADER_BUY_AMOUNT_RANGE_SOL: [number, number];
    TRADER_SELL_AMOUNT_RANGE_PERCENT: [number, number];
    TRADER_SWAP_DELAY_RANGE_SEC: [number, number];
}

const FILE_PATH_PATTERN = /^\/([\w.-]+\/?)*$/;

const convertToPercent = (value: string) => new Decimal(value).div(100).toNumber();

const convertToMilliseconds = (value: string) => new Decimal(value).mul(1_000).toNumber();

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
            INITIAL_POOL_SIZE_PERCENT: Joi.number()
                .required()
                .min(0.01)
                .max(100)
                .custom(convertToPercent)
                .description("Initial pool size (in percent)"),
            INITIAL_POOL_LIQUIDITY_SOL: Joi.number()
                .required()
                .min(0.01)
                .max(20)
                .description("Initial pool liquidity (in SOL)"),
            SNIPER_SHARE_POOL_PERCENTS: Joi.array()
                .required()
                .items(Joi.number().min(0.01).max(3).custom(convertToPercent))
                .unique()
                .min(1)
                .max(100)
                .description("Sniper share pool (in percents)"),
            INITIAL_SWAPPER_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Initial swapper balance (in SOL)"),
            TRADER_COUNT: Joi.number()
                .required()
                .integer()
                .min(1)
                .max(1_000)
                .description("Trader count"),
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
            RPC_URIS: process.env.RPC_URIS?.split(","),
            SNIPER_SHARE_POOL_PERCENTS: process.env.SNIPER_SHARE_POOL_PERCENTS?.split(","),
            PRIORITIZATION_FEE_MULTIPLIERS: process.env.PRIORITIZATION_FEE_MULTIPLIERS?.split(","),
            TRADER_BUY_AMOUNT_RANGE_SOL: process.env.TRADER_BUY_AMOUNT_RANGE_SOL?.split(","),
            TRADER_SELL_AMOUNT_RANGE_PERCENT:
                process.env.TRADER_SELL_AMOUNT_RANGE_PERCENT?.split(","),
            TRADER_SWAP_DELAY_RANGE_SEC: process.env.TRADER_SWAP_DELAY_RANGE_SEC?.split(","),
        });
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
