import { parseArgs } from "node:util";
import { clusterApiUrl } from "@solana/web3.js";
import Decimal from "decimal.js";
import Joi from "joi";
import { formatUri } from "../helpers/format";
import { Seed } from "./seed";

export type NodeEnv = "development" | "test" | "production";

export type LogLevel = "silent" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type RpcCluster = "devnet" | "mainnet-beta";

interface EnvironmentSchema {
    NODE_ENV: NodeEnv;
    LOG_LEVEL: LogLevel;
    LOGGER_NAME: string;
    PINATA_JWT: string;
    IPFS_GATEWAY_URI: string;
    RPC_URIS: Set<string>;
    RPC_CLUSTER: RpcCluster;
    EXPLORER_URI: string;
    KEYPAIR_ENCRYPTION_SECRET: string;
    TOKEN_SYMBOL: string;
    TOKEN_NAME: string;
    TOKEN_DESCRIPTION: string;
    TOKEN_DECIMALS: number;
    TOKEN_SUPPLY: number;
    TOKEN_WEBSITE_URI: string;
    TOKEN_TWITTER_URI: string;
    TOKEN_TELEGRAM_URI: string;
    TOKEN_TAGS: Set<string>;
    POOL_SIZE_PERCENT: number;
    POOL_LIQUIDITY_SOL: number;
    POOL_TRADING_CYCLE_COUNT: number;
    POOL_TRADING_PUMP_BIAS_PERCENT: number;
    POOL_TRADING_ONLY_NEW_TRADERS: boolean;
    SNIPER_POOL_SHARE_RANGE_PERCENT: [number, number];
    SNIPER_POOL_SHARE_PERCENTS: Set<number>;
    SNIPER_BALANCE_SOL: number;
    SNIPER_REPEATABLE_BUY_PERCENT: number;
    SNIPER_REPEATABLE_SELL_PERCENT: number;
    SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL: [number, number];
    SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT: [number, number];
    TRADER_COUNT: number;
    TRADER_BALANCE_SOL: number;
    TRADER_BUY_AMOUNT_RANGE_SOL: [number, number];
    TRADER_SELL_AMOUNT_RANGE_PERCENT: [number, number];
    SWAPPER_GROUP_SIZE: number;
    SWAPPER_TRADE_DELAY_RANGE_SEC: [number, number];
}

const ARRAY_SEPARATOR = ",";

const convertToDecimalFraction = (percent: string) =>
    new Decimal(percent).div(100).toDP(4, Decimal.ROUND_HALF_UP).toNumber();

const convertToMilliseconds = (seconds: string) =>
    new Decimal(seconds).mul(1_000).toDP(0, Decimal.ROUND_HALF_UP).toNumber();

const generateFloatRange = (start: number, end: number, step: number) => {
    const floatRange: number[] = [];
    for (let i = start; i <= end; i += step) {
        floatRange.push(parseFloat(i.toFixed(2)));
    }
    return floatRange;
};

export function isDryRun(): boolean {
    const {
        values: { "dry-run": dryRun },
    } = parseArgs({
        options: {
            "dry-run": {
                type: "boolean",
                short: "d",
                default: false,
            },
        },
    });

    return dryRun;
}

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
                .pattern(/^[a-z0-9-]+$/)
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
                                if (clusterApiUrl("mainnet-beta").includes(rpcUri)) {
                                    throw new Error(
                                        `Public mainnet RPC forbidden: ${formatUri(rpcUri)}`
                                    );
                                }

                                counters.mainnet++;
                            } else if (/devnet/i.test(rpcUri)) {
                                counters.devnet++;
                            } else {
                                throw new Error(
                                    `Unknown RPC cluster for URI: ${formatUri(rpcUri)}`
                                );
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
                .allow("https://explorer.solana.com", "https://solana.fm", "https://solscan.io")
                .default("https://solscan.io")
                .description("Solana explorer URI"),
            KEYPAIR_ENCRYPTION_SECRET: Joi.string()
                .required()
                .trim()
                .pattern(/^[0-9a-z]{32}$/)
                .description("Keypair encryption secret"),
            TOKEN_SYMBOL: Joi.string()
                .required()
                .trim()
                .uppercase()
                .pattern(/^[A-Z0-9-_.]+$/)
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
            TOKEN_WEBSITE_URI: Joi.string()
                .optional()
                .trim()
                .allow("")
                .uri()
                .description("Token website URI"),
            TOKEN_TWITTER_URI: Joi.string()
                .required()
                .trim()
                .uri()
                .custom((uri: string) => {
                    if (!uri.startsWith("https://x.com")) {
                        throw new Error(`Invalid Twitter URI: ${formatUri(uri)}`);
                    }
                    return uri;
                })
                .description("Token Twitter URI"),
            TOKEN_TELEGRAM_URI: Joi.string()
                .required()
                .trim()
                .uri()
                .custom((uri: string) => {
                    if (!uri.startsWith("https://t.me")) {
                        throw new Error(`Invalid Telegram URI: ${formatUri(uri)}`);
                    }
                    return uri;
                })
                .description("Token Telegram URI"),
            TOKEN_TAGS: Joi.array()
                .required()
                .items(
                    Joi.string()
                        .required()
                        .trim()
                        .allow("ai", "celebrity", "fun", "gaming", "meme", "sports")
                )
                .min(1)
                .max(3)
                .unique()
                .cast("set")
                .description("Token tags"),
            POOL_SIZE_PERCENT: Joi.number()
                .optional()
                .min(10)
                .max(100)
                .default(100)
                .custom(convertToDecimalFraction)
                .description("Pool size (in percent)"),
            POOL_LIQUIDITY_SOL: Joi.number()
                .required()
                .min(0.01)
                .max(100)
                .description("Pool liquidity (in SOL)"),
            POOL_TRADING_CYCLE_COUNT: Joi.number()
                .optional()
                .integer()
                .min(1)
                .max(100)
                .default(1)
                .description("Pool trading cycle count"),
            POOL_TRADING_PUMP_BIAS_PERCENT: Joi.number()
                .optional()
                .min(0)
                .max(100)
                .default(50)
                .custom(convertToDecimalFraction)
                .description("Pool trading pump bias (in percent)"),
            POOL_TRADING_ONLY_NEW_TRADERS: Joi.boolean()
                .optional()
                .default(false)
                .description("Pool trading with only new traders"),
            SNIPER_POOL_SHARE_RANGE_PERCENT: Joi.array()
                .required()
                .items(Joi.number().min(0.5).max(3).custom(convertToDecimalFraction))
                .unique()
                .sort({ order: "ascending" })
                .min(2)
                .max(2)
                .description("Sniper pool share range (in percents)"),
            SNIPER_POOL_SHARE_PERCENTS: Joi.array()
                .default(
                    Joi.ref("SNIPER_POOL_SHARE_RANGE_PERCENT", {
                        adjust: (range: [number, number]) => {
                            const seed = new Seed(process.env.NODE_ENV, process.env.TOKEN_SYMBOL);
                            return seed.shuffle(
                                generateFloatRange(range[0] * 100, range[1] * 100, 0.01).map(
                                    (value) => convertToDecimalFraction(value.toString())
                                )
                            );
                        },
                    })
                )
                .cast("set")
                .description("Sniper pool share percents"),
            SNIPER_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Sniper balance (in SOL)"),
            SNIPER_REPEATABLE_BUY_PERCENT: Joi.number()
                .optional()
                .min(0)
                .max(50)
                .default(0)
                .custom(convertToDecimalFraction)
                .description("Sniper repeatable buy percent"),
            SNIPER_REPEATABLE_SELL_PERCENT: Joi.number()
                .optional()
                .min(0)
                .max(50)
                .default(0)
                .custom(convertToDecimalFraction)
                .description("Sniper repeatable sell percent"),
            SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL: Joi.when("SNIPER_REPEATABLE_BUY_PERCENT", {
                switch: [
                    {
                        is: Joi.number().greater(0),
                        then: Joi.array()
                            .required()
                            .items(Joi.number().min(0.001).max(0.1))
                            .unique()
                            .sort({ order: "ascending" })
                            .min(2)
                            .max(2),
                    },
                ],
                otherwise: Joi.array().optional().default([0, 0]),
            }).description("Sniper repeatable buy amount range (in SOL)"),
            SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT: Joi.when(
                "SNIPER_REPEATABLE_SELL_PERCENT",
                {
                    switch: [
                        {
                            is: Joi.number().greater(0),
                            then: Joi.array()
                                .required()
                                .items(
                                    Joi.number().min(0.01).max(1).custom(convertToDecimalFraction)
                                )
                                .unique()
                                .sort({ order: "ascending" })
                                .min(2)
                                .max(2),
                        },
                    ],
                    otherwise: Joi.array().optional().default([0, 0]),
                }
            ).description("Sniper repeatable sell amount range (in percent)"),
            TRADER_COUNT: Joi.number()
                .optional()
                .integer()
                .min(0)
                .max(1_000)
                .default(0)
                .description("Trader count"),
            TRADER_BALANCE_SOL: Joi.number()
                .required()
                .min(0.005)
                .max(0.1)
                .description("Trader balance (in SOL)"),
            TRADER_BUY_AMOUNT_RANGE_SOL: Joi.array()
                .required()
                .items(Joi.number().min(0.001).max(0.1))
                .unique()
                .sort({ order: "ascending" })
                .min(2)
                .max(2)
                .description("Trader buy amount range (in SOL)"),
            TRADER_SELL_AMOUNT_RANGE_PERCENT: Joi.array()
                .required()
                .items(Joi.number().min(1).max(100).custom(convertToDecimalFraction))
                .unique()
                .sort({ order: "ascending" })
                .min(2)
                .max(2)
                .description("Trader sell amount range (in percent)"),
            SWAPPER_GROUP_SIZE: Joi.number()
                .optional()
                .integer()
                .min(1)
                .max(5)
                .default(1)
                .description("Swapper group size"),
            SWAPPER_TRADE_DELAY_RANGE_SEC: Joi.array()
                .required()
                .items(Joi.number().min(1).max(10).custom(convertToMilliseconds))
                .unique()
                .sort({ order: "ascending" })
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
            TOKEN_TAGS: process.env.TOKEN_TAGS?.split(ARRAY_SEPARATOR),
            SNIPER_POOL_SHARE_RANGE_PERCENT: process.env.SNIPER_POOL_SHARE_RANGE_PERCENT
                ? process.env.SNIPER_POOL_SHARE_RANGE_PERCENT.split(ARRAY_SEPARATOR)
                : [],
            SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL:
                process.env.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL?.split(ARRAY_SEPARATOR),
            SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT:
                process.env.SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT?.split(ARRAY_SEPARATOR),
            TRADER_BUY_AMOUNT_RANGE_SOL:
                process.env.TRADER_BUY_AMOUNT_RANGE_SOL?.split(ARRAY_SEPARATOR),
            TRADER_SELL_AMOUNT_RANGE_PERCENT:
                process.env.TRADER_SELL_AMOUNT_RANGE_PERCENT?.split(ARRAY_SEPARATOR),
            SWAPPER_TRADE_DELAY_RANGE_SEC:
                process.env.SWAPPER_TRADE_DELAY_RANGE_SEC?.split(ARRAY_SEPARATOR),
        });
    if (error) {
        throw new Error(error.annotate());
    }

    return envVars;
}
