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
