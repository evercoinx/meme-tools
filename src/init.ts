import "source-map-support/register";
import Decimal from "decimal.js";
import dotenv from "dotenv";

process.removeAllListeners("warning");

process.on("warning", (warning) => {
    if (warning.name === "DeprecationWarning") {
        return;
    }
    console.warn(warning);
});

dotenv.config({
    path: `.env.${process.env.NODE_ENV}`,
    encoding: "utf8",
});

Decimal.set({
    crypto: true,
    precision: 9,
    rounding: Decimal.ROUND_FLOOR,
});
