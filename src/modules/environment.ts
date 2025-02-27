import Decimal from "decimal.js";
import Joi from "joi";

export type NODE_ENV = "development" | "test" | "production";

export type LOG_LEVEL = "silent" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface EnvironmentSchema {
    NODE_ENV: NODE_ENV;
    LOG_LEVEL: LOG_LEVEL;
    LOGGER_NAME: string;
    PINATA_JWT: string;
    IPFS_GATEWAY_URI: string;
    RPC_URIS: Set<string>;
    RPC_CLUSTER: "devnet" | "mainnet-beta";
    EXPLORER_URI: string;
    KEYPAIR_FILE_PATH_DEV: string;
    KEYPAIR_FILE_PATH_DISTRIBUTOR: string;
    KEYPAIR_ENCRYPTION_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_NAME: string;
    TOKEN_DESCRIPTION: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    POOL_SIZE_PERCENT: number;
    POOL_LIQUIDITY_SOL: number;
    POOL_TRADING_MODE: "volume" | "pump" | "dump";
    POOL_TRADING_CYCLE_COUNT: number;
    SNIPER_POOL_SHARE_PERCENTS: number[];
    SNIPER_BALANCE_SOL: number;
    TRADER_COUNT: number;
    TRADER_GROUP_SIZE: number;
    TRADER_BALANCE_SOL: number;
    TRADER_BUY_AMOUNT_RANGE_SOL: [number, number];
    TRADER_SELL_AMOUNT_RANGE_PERCENT: [number, number];
    TRADER_SWAP_DELAY_RANGE_SEC: [number, number];
    TRADER_SWAP_ATTEMPTS: number;
}

const FILE_PATH_PATTERN = /^\/([\w.-]+\/?)*$/;
const ARRAY_SEPARATOR = ",";

const convertToFractionalPercent = (percent: string) =>
    new Decimal(percent).div(100).toDP(4).toNumber();
const convertToMilliseconds = (seconds: string) =>
    new Decimal(seconds).mul(1_000).round().toNumber();

export function extractEnvironmentVariables(): EnvironmentSchema {
    const envSchema = Joi.object()
        .keys({
            NODE_ENV: Joi.string()
                .required()
                .trim()
                .valid("development", "test", "production")
                .description("Node environment"),
            LOG_LEVEL: Joi.string()
                .optional()
                .trim()
                .valid("silent", "trace", "debug", "info", "warn", "error", "fatal")
                .default("info")
                .description("Log level"),
            LOGGER_NAME: Joi.string()
                .optional()
                .trim()
                .pattern(/^[a-z0-9-_]+$/)
                .description("Logger name"),
            PINATA_JWT: Joi.string()
                .required()
                .trim()
                .pattern(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/)
                .description("Pinata JSON web token"),
            IPFS_GATEWAY_URI: Joi.string().required().trim().uri().description("IPFS Gateway"),
            RPC_URIS: Joi.array()
                .required()
                .items(Joi.string().required().trim().uri())
                .min(1)
                .max(6)
                .unique()
                .cast("set")
                .description("Solana RPC URIs"),
            RPC_CLUSTER: Joi.string().default(
                Joi.ref("RPC_URIS", {
                    adjust: (rpcUris: Set<string>) => {
                        const counters = {
                            devnet: 0,
                            mainnet: 0,
                        };

                        for (const rpcUri of rpcUris.values()) {
                            if (/mainnet/i.test(rpcUri)) {
                                counters.mainnet++;
                            } else if (/devnet/i.test(rpcUri)) {
                                counters.devnet++;
                            } else {
                                throw new Error(`Unknown RPC cluster for URI: ${rpcUri}`);
                            }
                        }

                        if (counters.mainnet === rpcUris.size) {
                            return "mainnet-beta";
                        }
                        if (counters.devnet === rpcUris.size) {
                            return "devnet";
                        }

                        throw new Error("Mixed RPC clusters detected");
                    },
                })
            ),
            EXPLORER_URI: Joi.string()
                .optional()
                .trim()
                .uri()
                .allow("https://solana.fm", "https://explorer.solana.com")
                .default("https://solana.fm")
                .description("Solana explorer URI"),
            KEYPAIR_FILE_PATH_DEV: Joi.string()
                .required()
                .trim()
                .pattern(FILE_PATH_PATTERN)
                .description("Dev keypair file path"),
            KEYPAIR_FILE_PATH_DISTRIBUTOR: Joi.string()
                .required()
                .trim()
                .pattern(FILE_PATH_PATTERN)
                .description("Distributor keypair file path"),
            KEYPAIR_ENCRYPTION_SECRET: Joi.string()
                .required()
                .trim()
                .pattern(/^[0-9a-z]{32}$/)
                .description("Keypair encryption secret"),
            TOKEN_SYMBOL: Joi.string()
                .required()
                .trim()
                .uppercase()
                .alphanum()
                .max(20)
                .description("Token symbol"),
            TOKEN_NAME: Joi.string().optional().trim().allow("").max(40).description("Token name"),
            TOKEN_DESCRIPTION: Joi.string()
                .optional()
                .trim()
                .allow("")
                .max(200)
                .description("Token description"),
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
                .custom(convertToFractionalPercent)
                .description("Pool size (in percent)"),
            POOL_LIQUIDITY_SOL: Joi.number()
                .required()
                .min(0.01)
                .max(20)
                .description("Pool liquidity (in SOL)"),
            POOL_TRADING_MODE: Joi.string()
                .optional()
                .trim()
                .valid("volume", "pump", "dump")
                .default("volume")
                .description("Pool trading mode"),
            POOL_TRADING_CYCLE_COUNT: Joi.number()
                .optional()
                .integer()
                .min(2)
                .max(100)
                .default(2)
                .description("Pool trading cycle count"),
            SNIPER_POOL_SHARE_PERCENTS: Joi.array()
                .required()
                .items(Joi.number().min(0.5).max(3).custom(convertToFractionalPercent))
                .unique()
                .min(1)
                .max(100)
                .description("Sniper share pool (in percents)"),
            SNIPER_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Sniper balance (in SOL)"),
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
            TRADER_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Trader balance (in SOL)"),
            TRADER_BUY_AMOUNT_RANGE_SOL: Joi.array()
                .required()
                .items(Joi.number().min(0.001).max(0.1))
                .unique()
                .min(2)
                .max(2)
                .description("Trader buy amount range (in SOL)"),
            TRADER_SELL_AMOUNT_RANGE_PERCENT: Joi.array()
                .required()
                .items(Joi.number().min(1).max(100).custom(convertToFractionalPercent))
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
            TRADER_SWAP_ATTEMPTS: Joi.number()
                .optional()
                .integer()
                .min(2)
                .max(100)
                .default(2)
                .description("Trader swap attempts"),
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
            SNIPER_POOL_SHARE_PERCENTS:
                process.env.SNIPER_POOL_SHARE_PERCENTS?.split(ARRAY_SEPARATOR),
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
