import {
    formatDecimal,
    formatError,
    formatInteger,
    formatMilliseconds,
    formatText,
    formatPercent,
    formatUri,
    OUTPUT_UNKNOWN_VALUE,
} from "../helpers/format";
import { envVars, logger } from "../modules";

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
    logger.info(
        "Configuration (%s):\n\t\tIPFS gateway URI: %s\n\t\tRPC URIs: %s (Total: %s)\n\t\tExplorer URI: %s\n\n\t\tToken symbol: %s\n\t\tToken name: %s\n\t\tToken description: %s\n\t\tToken decimals: %s\n\t\tToken supply: %s\n\t\tToken webiste URI: %s\n\t\tToken Twitter URI: %s\n\t\tToken Telegram URI: %s\n\t\tToken tags: %s\n\n\t\tPool size: %s\n\t\tPool liquidity: %s SOL\n\t\tPool trading cycle count: %s\n\t\tPool trading pump bias: %s\n\n\t\tSniper shares in pool: %s (Total: %s)\n\t\tSniper balance: %s SOL\n\t\tSniper repeatable buy: %s SOL\n\t\tSniper repeatable sell: %s\n\t\tSniper repeatable buy amount: %s SOL\n\t\tSniper repeatable sell amount: %s\n\n\t\tTrader count: %s\n\t\tTrader balance: %s SOL\n\t\tTrader buy amount: %s SOL\n\t\tTrader sell amount: %s\n\n\t\tSwapper group size: %s\n\t\tSwapper trade delay: %s sec",
        formatText(envVars.NODE_ENV, true),
        formatUri(envVars.IPFS_GATEWAY_URI),
        Array.from(envVars.RPC_URIS)
            .map((rpcUri) => formatUri(new URL(rpcUri).origin))
            .join(" "),
        formatInteger(envVars.RPC_URIS.size),
        formatUri(envVars.EXPLORER_URI),
        formatText(envVars.TOKEN_SYMBOL),
        formatText(envVars.TOKEN_NAME),
        formatText(envVars.TOKEN_DESCRIPTION),
        formatInteger(envVars.TOKEN_DECIMALS),
        formatInteger(envVars.TOKEN_SUPPLY),
        envVars.TOKEN_WEBSITE_URI ? formatUri(envVars.TOKEN_WEBSITE_URI) : OUTPUT_UNKNOWN_VALUE,
        envVars.TOKEN_TWITTER_URI ? formatUri(envVars.TOKEN_TWITTER_URI) : OUTPUT_UNKNOWN_VALUE,
        envVars.TOKEN_TELEGRAM_URI ? formatUri(envVars.TOKEN_TELEGRAM_URI) : OUTPUT_UNKNOWN_VALUE,
        Array.from(envVars.TOKEN_TAGS)
            .map((tag) => formatText(tag))
            .join(" "),
        formatPercent(envVars.POOL_SIZE_PERCENT),
        formatDecimal(envVars.POOL_LIQUIDITY_SOL),
        formatInteger(envVars.POOL_TRADING_CYCLE_COUNT),
        formatPercent(envVars.POOL_TRADING_PUMP_BIAS_PERCENT),
        Array.from(envVars.SNIPER_POOL_SHARE_PERCENTS)
            .map((poolShare) => formatPercent(poolShare))
            .join(" "),
        formatInteger(envVars.SNIPER_POOL_SHARE_PERCENTS.size),
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
