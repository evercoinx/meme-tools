import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import pc from "picocolors";

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

    return pc.green(
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

    return pc.yellow(
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

    return pc.green(
        new Intl.NumberFormat(LOCALE, {
            style: "decimal",
            maximumFractionDigits: decimalPlaces,
            roundingMode: "trunc",
        }).format(value)
    );
}

export function formatPercent(value: NumberLike): string {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return pc.green(
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
    return pc.magenta(
        format === "short"
            ? `${publicKeyStr.slice(0, 4)}...${publicKeyStr.slice(-4)}`
            : publicKeyStr
    );
}

export function formatSignature(signature: string, format: "short" | "long" = "short"): string {
    return pc.yellow(
        format === "short" ? `${signature.slice(0, 8)}...${signature.slice(-8)}` : signature
    );
}
