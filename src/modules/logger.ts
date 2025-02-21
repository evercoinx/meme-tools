import { join } from "node:path";
import pino, { Logger, TransportTargetOptions } from "pino";

export function createLogger(scope: string, name: string, level: string, logPath: string): Logger {
    const dirName = join(logPath, scope.toLocaleLowerCase(), name);
    const fileName = `${new Date().toISOString().slice(0, 19)}.log`;

    const targets: TransportTargetOptions[] = [
        {
            target: "pino-pretty",
            options: {
                destination: 1, // stdout
                colorize: true,
                timestampKey: "time",
            },
        },
    ];

    if (name && !name.startsWith("get")) {
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
        level,
        base: undefined,
        transport: {
            targets,
        },
    });
}
