import { join } from "node:path";
import { parseArgs } from "node:util";
import pino, { Logger, stdTimeFunctions, TransportTargetOptions } from "pino";

export interface LogEntry {
    level: number;
    time: number;
    name: string;
    msg: string;
}

export function createLogger(
    tokenSymbol: string,
    name: string,
    level: string,
    logPath: string
): Logger {
    const dirName = join(logPath, tokenSymbol.toLocaleLowerCase(), name);
    const fileName = `${new Date().toISOString().slice(0, 19)}.log`;

    const targets: TransportTargetOptions[] = [
        {
            target: "pino-pretty",
            level,
            options: {
                destination: 1, // stdout
                colorize: true,
                translateTime: name.startsWith("replay")
                    ? "SYS:dd/mm/yy HH:MM:ss.l"
                    : "SYS:HH:MM:ss.l",
            },
        },
    ];

    const {
        values: { "dry-run": dryRun },
    } = parseArgs({
        options: {
            "dry-run": {
                type: "boolean",
                default: false,
            },
        },
    });

    if (name && !/^(cleanup|generate|get|grind|rename|replay)/i.test(name) && !dryRun) {
        targets.push({
            target: "pino/file",
            level: "info",
            options: {
                destination: join(dirName, fileName),
                mkdir: true,
                append: true,
            },
        });
    }

    return pino({
        name,
        timestamp: stdTimeFunctions.epochTime,
        level,
        base: undefined,
        transport: { targets },
    });
}

export async function suppressLogs<T>(fn: () => Promise<T>): Promise<T> {
    const { write } = process.stdout;
    process.stdout.write = () => true;

    try {
        return await fn();
    } finally {
        process.stdout.write = write;
    }
}
