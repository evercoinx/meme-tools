import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

const locale = "en-US";

export const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    roundingMode: "trunc",
});

export const decimal = new Intl.NumberFormat(locale, {
    style: "decimal",
    maximumFractionDigits: 4,
    roundingMode: "trunc",
});

export const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "UTC",
});

export const integer = new Intl.NumberFormat(locale, {
    style: "decimal",
    maximumFractionDigits: 0,
    roundingMode: "trunc",
});

export const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
});

export function formatSol(amount: BN | bigint | number) {
    const number = new Decimal(amount.toString(10)).div(LAMPORTS_PER_SOL).toNumber();
    return decimal.format(number);
}

export function formatUnits(amount: BN | bigint | number, units: number) {
    const number = new Decimal(amount.toString(10)).div(units).toNumber();
    return integer.format(number);
}
