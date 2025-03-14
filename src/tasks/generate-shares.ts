import { parseArgs } from "node:util";
import { formatDecimal, formatError, formatInteger } from "../helpers/format";
import { generateRandomFloat } from "../helpers/random";
import { logger } from "../modules";

const MAX_ATTEMPTS = 500_000;

(async () => {
    try {
        const {
            values: { count, sum, deviation, attempts },
        } = parseArgs({
            options: {
                count: {
                    type: "string",
                },
                sum: {
                    type: "string",
                },
                deviation: {
                    type: "string",
                },
                attempts: {
                    type: "string",
                    default: String(MAX_ATTEMPTS),
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
        if (parsedAttempts > MAX_ATTEMPTS) {
            throw new Error(`Too many attempts: ${formatInteger(parsedAttempts)}`);
        }

        const shares = generateShares(parsedCount, parsedSum, parsedDeviation, parsedAttempts);

        logger.info("Shares: %s", shares.map((share) => formatDecimal(share, 2)).join(","));
        logger.info("Total sum: %s", formatDecimal(sumNumbers(shares), 2));

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

function generateShares(
    count: number,
    totalSum: number,
    deviation: number,
    attempts: number
): number[] {
    const average = totalSum / count;
    const min = average * (1 - deviation);
    const max = average * (1 + deviation);
    const range = max - min;
    const targetExcess = totalSum - count * min;

    for (let i = 0; i < attempts; i++) {
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

        if (i > 0 && i % 25_000 === 0) {
            console.log(`Attempts made: ${formatInteger(i)}`);
        }
    }

    throw new Error(`Failed to generate shares. Attempts: ${formatInteger(attempts)}`);
}

function sumNumbers(numbers: number[]): number {
    return numbers.reduce((a, b) => a + b, 0);
}
