import pino, { Logger } from "pino";

export function createLogger(level: string, id: string): Logger {
    return pino({
        level,
        base: undefined,
        transport: {
            targets: [
                {
                    target: "pino/file",
                    options: {
                        destination: `./logs/${id.toLocaleLowerCase()}.json`,
                        mkdir: true,
                        append: true,
                    },
                },
                {
                    target: "pino-pretty",
                    options: {
                        destination: 1, // stdout
                        colorize: true,
                        timestampKey: "time",
                    },
                },
            ],
        },
    });
}
