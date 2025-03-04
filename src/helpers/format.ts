import { basename } from "node:path";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import chalk from "chalk";
import Decimal from "decimal.js";

type NumberLike = number | bigint | Decimal | BN;

const LOCALE = "en-US";

export function capitalize(str: string): string {
    return `${str.slice(0, 1).toUpperCase()}${str.slice(1)}`;
}

export function formatCurrency(value: NumberLike): string {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return chalk.green(
        new Intl.NumberFormat(LOCALE, {
            style: "currency",
            currency: "USD",
            roundingMode: "trunc",
        }).format(value)
    );
}

export function formatDate(value: Date | number): string {
    if (typeof value === "number") {
        value = new Date(value * 1e3);
    }

    return chalk.yellow(
        new Intl.DateTimeFormat(LOCALE, {
            dateStyle: "full",
            timeStyle: "long",
            timeZone: "UTC",
        }).format(value)
    );
}

export function formatDecimal(value: NumberLike, decimalPlaces = 9): string {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return chalk.green(
        new Intl.NumberFormat(LOCALE, {
            style: "decimal",
            maximumFractionDigits: decimalPlaces,
            roundingMode: "trunc",
        }).format(value)
    );
}

export function formatInteger(value: NumberLike): string {
    return formatDecimal(value, 0);
}

export function formatMilliseconds(value: number): string {
    return formatDecimal(value / 1_000, 3);
}

export function formatPercent(value: NumberLike): string {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return chalk.green(
        new Intl.NumberFormat(LOCALE, {
            style: "percent",
            minimumFractionDigits: 2,
        }).format(value)
    );
}

export function formatPublicKey(
    publicKey: string | PublicKey,
    format: "short" | "long" = "short"
): string {
    const publicKeyStr = typeof publicKey === "string" ? publicKey : publicKey.toBase58();
    return chalk.magenta(
        format === "short"
            ? `${publicKeyStr.slice(0, 4)}...${publicKeyStr.slice(-4)}`
            : publicKeyStr
    );
}

export function formatSignature(signature: string, format: "short" | "long" = "short"): string {
    return chalk.yellow(
        format === "short" ? `${signature.slice(0, 8)}...${signature.slice(-8)}` : signature
    );
}

export function formatFileName(path: string): string {
    return chalk.blue(basename(path));
}

export function formatName(name: string): string {
    return chalk.yellow(name);
}
