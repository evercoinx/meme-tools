import "source-map-support/register";
import dotenv from "dotenv";

process.removeAllListeners("warning");

process.on("warning", (warning) => {
    if (warning.name === "DeprecationWarning") {
        return;
    }
    console.warn(warning);
});

dotenv.config({
    path: process.env.NODE_ENV === "development" ? ".env" : ".env.production",
    encoding: "utf8",
});
