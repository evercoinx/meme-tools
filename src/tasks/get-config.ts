import chalk from "chalk";
import { envVars, logger } from "../modules";
import { formatDecimal } from "../helpers/format";

(async () => {
    try {
        logger.info(
            "Configuration (%s):\n\t\tToken symbol: %s\n\t\tToken name: %s\n\t\tToken description: %s\n\t\tToken supply: %s\n\n\t\tPool size: %s\n\t\tPool liquidity: %s SOL\n\t\tPool trading cycle count: %s\n\n\t\tSniper shares in pool: %s\n\t\tSniper balance: %s SOL\n\n\t\tTrader count: %s\n\t\tTrader group size: %s\n\t\tTrader balance: %s SOL\n\t\tTrader buy amount: %s SOL\n\t\tTrader sell amount: %s\n\t\tTrader swap delay: %s sec\n\t\tTrader swap attempts: %s",
            chalk.bgYellow(envVars.NODE_ENV),
            chalk.yellow(envVars.TOKEN_SYMBOL),
            chalk.yellow(envVars.TOKEN_NAME),
            chalk.yellow(envVars.TOKEN_DESCRIPTION),
            chalk.green(formatDecimal(envVars.TOKEN_SUPPLY, 0)),
            chalk.green(`${formatDecimal(envVars.POOL_SIZE_PERCENT * 100, 2)}%`),
            chalk.green(formatDecimal(envVars.POOL_LIQUIDITY_SOL)),
            chalk.green(formatDecimal(envVars.POOL_TRADING_CYCLE_COUNT)),
            envVars.SNIPER_POOL_SHARE_PERCENTS.map((poolShare) =>
                chalk.green(`${poolShare * 100}%`)
            ).join(" "),
            chalk.green(formatDecimal(envVars.SNIPER_BALANCE_SOL)),
            chalk.green(formatDecimal(envVars.TRADER_COUNT, 0)),
            chalk.green(formatDecimal(envVars.TRADER_GROUP_SIZE, 0)),
            chalk.green(formatDecimal(envVars.TRADER_BALANCE_SOL)),
            chalk.green(
                formatDecimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[0]),
                "-",
                formatDecimal(envVars.TRADER_BUY_AMOUNT_RANGE_SOL[1])
            ),
            chalk.green(
                formatDecimal(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT[0] * 100),
                "-",
                `${formatDecimal(envVars.TRADER_SELL_AMOUNT_RANGE_PERCENT[1] * 100)}%`
            ),
            chalk.green(
                formatDecimal(envVars.TRADER_SWAP_DELAY_RANGE_SEC[0] / 1_000, 3),
                "-",
                formatDecimal(envVars.TRADER_SWAP_DELAY_RANGE_SEC[1] / 1_000, 3)
            ),
            chalk.green(formatDecimal(envVars.TRADER_SWAP_ATTEMPTS, 0))
        );

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();
