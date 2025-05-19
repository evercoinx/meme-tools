import {
    formatDecimal,
    formatError,
    formatInteger,
    formatMilliseconds,
    formatText,
    formatPercent,
    formatPublicKey,
    formatUri,
    OUTPUT_UNKNOWN_VALUE,
} from "../helpers/format";
import { envVars, logger } from "../modules";
import { generateOffchainTokenMetadata } from "./create-mint";

(async () => {
    try {
        getConfig();
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

function getConfig(): void {
    const tokenMetadata = generateOffchainTokenMetadata(
        envVars.TOKEN_SYMBOL,
        envVars.TOKEN_NAME,
        envVars.TOKEN_DESCRIPTION,
        envVars.TOKEN_DECIMALS,
        "",
        envVars.TOKEN_TAGS,
        envVars.TOKEN_WEBSITE_URI,
        envVars.TOKEN_TWITTER_URI,
        envVars.TOKEN_TELEGRAM_URI
    );

    logger.info(
        "Configuration (%s):\n\t\tIPFS gateway URI: %s\n\t\tRPC URIs: %s (Items: %s)\n\t\tExplorer URI: %s\n\n\t\tToken symbol: %s\n\t\tToken name: %s\n\t\tToken description: %s\n\t\tToken decimals: %s\n\t\tToken supply: %s\n\t\tToken webiste URI: %s\n\t\tToken Twitter URI: %s\n\t\tToken Telegram URI: %s\n\t\tToken tags: %s\n\n\t\tPool size: %s\n\t\tPool liquidity: %s SOL\n\t\tPool trading cycle count: %s\n\t\tPool trading pump bias: %s\n\n\t\tCollector public key: %s\n\n\t\tSniper pool shares: %s (Items: %s, Sum: %s)\n\t\tSniper balance: %s SOL\n\t\tSniper repeatable buy: %s\n\t\tSniper repeatable sell: %s\n\t\tSniper repeatable buy amount: %s SOL\n\t\tSniper repeatable sell amount: %s\n\n\t\tTrader count: %s\n\t\tTrader balance: %s SOL\n\t\tTrader buy amount: %s SOL\n\t\tTrader sell amount: %s\n\n\t\tSwapper group size: %s\n\t\tSwapper trade delay: %s sec",
        formatText(envVars.NODE_ENV, true),
        formatUri(envVars.IPFS_GATEWAY_URI),
        Array.from(envVars.RPC_URIS)
            .map((rpcUri) => formatUri(new URL(rpcUri).origin))
            .join(" "),
        formatInteger(envVars.RPC_URIS.size),
        formatUri(envVars.EXPLORER_URI),
        formatText(tokenMetadata.symbol),
        formatText(tokenMetadata.name),
        formatText(tokenMetadata.description),
        formatInteger(tokenMetadata.decimals),
        formatInteger(envVars.TOKEN_SUPPLY),
        tokenMetadata.external_url ? formatUri(tokenMetadata.external_url) : OUTPUT_UNKNOWN_VALUE,
        tokenMetadata.social_links?.twitter
            ? formatUri(tokenMetadata.social_links.twitter)
            : OUTPUT_UNKNOWN_VALUE,
        tokenMetadata.social_links?.telegram
            ? formatUri(tokenMetadata.social_links.telegram)
            : OUTPUT_UNKNOWN_VALUE,
        Array.from(envVars.TOKEN_TAGS)
            .map((tag) => formatText(tag))
            .join(" "),
        formatPercent(envVars.POOL_SIZE_PERCENT),
        formatDecimal(envVars.POOL_LIQUIDITY_SOL),
        formatInteger(envVars.POOL_TRADING_CYCLE_COUNT),
        formatPercent(envVars.POOL_TRADING_PUMP_BIAS_PERCENT),
        formatPublicKey(envVars.COLLECTOR_PUBLIC_KEY, "long"),
        Array.from(envVars.SNIPER_POOL_SHARE_PERCENTS)
            .map((poolShare) => formatPercent(poolShare))
            .join(" "),
        formatInteger(envVars.SNIPER_POOL_SHARE_PERCENTS.size),
        formatPercent(
            Array.from(envVars.SNIPER_POOL_SHARE_PERCENTS).reduce((sum, value) => sum + value, 0)
        ),
        formatDecimal(envVars.SNIPER_BALANCE_SOL),
        formatPercent(envVars.SNIPER_REPEATABLE_BUY_PERCENT),
        formatPercent(envVars.SNIPER_REPEATABLE_SELL_PERCENT),
        [
            formatDecimal(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL[0]),
            " - ",
            formatDecimal(envVars.SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL[1]),
        ].join(""),
        [
            formatPercent(envVars.SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT[0]),
            " - ",
            formatPercent(envVars.SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT[1]),
        ].join(""),
        formatInteger(envVars.TRADER_COUNT),
        formatDecimal(envVars.TRADER_BALANCE_SOL),
        [
            formatDecimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[0]),
            " - ",
            formatDecimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1]),
        ].join(""),
        [
            formatPercent(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT[0]),
            " - ",
            formatPercent(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT[1]),
        ].join(""),
        formatInteger(envVars.SWAPPER_GROUP_SIZE),
        [
            formatMilliseconds(envVars.SWAPPER_TRADE_DELAY_RANGE_SEC[0]),
            " - ",
            formatMilliseconds(envVars.SWAPPER_TRADE_DELAY_RANGE_SEC[1]),
        ].join("")
    );
}
