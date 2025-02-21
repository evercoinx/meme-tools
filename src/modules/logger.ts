import { join } from "node:path";
import pino, { Logger, stdTimeFunctions, TransportTargetOptions } from "pino";

export function createLogger(scope: string, name: string, level: string, logPath: string): Logger {
    const dirName = join(logPath, scope.toLocaleLowerCase(), name);
    const fileName = `${new Date().toISOString().slice(0, 19)}.log`;

    const targets: TransportTargetOptions[] = [
        {
            target: "pino-pretty",
            options: {
                destination: 1, // stdout
                colorize: true,
                translateTime: name.startsWith("replay")
                    ? "SYS:dd/mm/yy HH:MM:ss.l"
                    : "SYS:HH:MM:ss.l",
            },
        },
    ];

    if (name && !/^(get|replay)/.test(name)) {
        targets.push({
            target: "pino/file",
            options: {
                destination: join(dirName, fileName),
                mkdir: true,
                append: true,
            },
        });
    }

    return pino({
        timestamp: stdTimeFunctions.epochTime,
        level,
        base: undefined,
        transport: { targets },
    });
}
