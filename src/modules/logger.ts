import pino, { Logger } from "pino";

export function createLogger(level: string): Logger {
    return pino({
        level,
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                ignore: "pid,hostname",
                timestampKey: "time",
            },
        },
    });
}
