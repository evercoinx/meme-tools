import BN from "bn.js";
import Decimal from "decimal.js";

type NumberLike = number | bigint | Decimal | BN;

const LOCALE = "en-US";

export function formatCurrency(value: NumberLike) {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: "USD",
        roundingMode: "trunc",
    }).format(value);
}

export function formatDecimal(value: NumberLike, decimalPlaces = 9) {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return new Intl.NumberFormat(LOCALE, {
        style: "decimal",
        maximumFractionDigits: decimalPlaces,
        roundingMode: "trunc",
    }).format(value);
}

export function formatDate(value: Date | number) {
    if (typeof value === "number") {
        value = new Date(value * 1e3);
    }

    return new Intl.DateTimeFormat(LOCALE, {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: "UTC",
    }).format(value);
}

export function formatPercent(value: NumberLike) {
    if (Decimal.isDecimal(value)) {
        value = value.toNumber();
    } else if (value instanceof BN) {
        value = BigInt(value.toString(10));
    }

    return new Intl.NumberFormat(LOCALE, {
        style: "percent",
        minimumFractionDigits: 2,
    }).format(value);
}
