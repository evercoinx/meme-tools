import { parseArgs } from "node:util";
import chalk from "chalk";
import { formatDecimal } from "../helpers/format";
import { generateRandomFloat } from "../helpers/random";
import { logger } from "../modules";

(async () => {
    try {
        const {
            values: { count, sum, deviation, attempts },
        } = parseArgs({
            options: {
                count: {
                    type: "string",
                    short: "c",
                },
                sum: {
                    type: "string",
                    short: "s",
                },
                deviation: {
                    type: "string",
                    short: "d",
                },
                attempts: {
                    type: "string",
                    short: "a",
                    default: "10000",
                },
            },
        });

        if (!count) {
            throw new Error("Count not defined");
        }
        const parsedCount = parseInt(count);

        if (!sum) {
            throw new Error("Sum not defined");
        }
        const parsedSum = parseInt(sum);

        if (!deviation) {
            throw new Error("Deviation not defined");
        }
        const parsedDeviation = parseInt(deviation) / 100;

        const parsedAttempts = parseInt(attempts);
        if (parsedAttempts > 100_000) {
            throw new Error("Too many attempts");
        }

        const poolShares = generatePoolShares(
            parsedCount,
            parsedSum,
            parsedDeviation,
            parsedAttempts
        );

        logger.info(
            "Pool shares: %s",
            poolShares.map((poolShare) => chalk.green(poolShare)).join(",")
        );
        logger.info("Total sum: %s", formatDecimal(sumNumbers(poolShares), 2));

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

function generatePoolShares(
    count: number,
    totalSum: number,
    deviation: number,
    maxAttempts: number
): number[] {
    const average = totalSum / count;
    const min = average * (1 - deviation);
    const max = average * (1 + deviation);
    const range = max - min;
    const targetExcess = totalSum - count * min;

    for (let i = 0; i < maxAttempts; i++) {
        const randoms = Array.from({ length: count }, () => generateRandomFloat([0, 1]));
        const randomSum = sumNumbers(randoms);

        const excesses = randoms.map((random) => (random / randomSum) * targetExcess);
        if (excesses.every((excess) => excess <= range)) {
            const values = excesses.map((excess) => Number((min + excess).toFixed(2)));

            const valueSum = sumNumbers(values);
            if (new Set(values).size === count && Math.abs(valueSum - totalSum) < 0.05) {
                return values;
            }
        }
    }

    throw new Error(`Failed to generate valid numbers after ${maxAttempts} attempts`);
}

function sumNumbers(numbers: number[]) {
    return numbers.reduce((a, b) => a + b, 0);
}
