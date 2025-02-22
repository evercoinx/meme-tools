import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { envVars, LOG_DIR, logger } from "../modules";
import { LOG_LEVEL } from "../modules/environment";

interface LogEntry {
    level: number;
    time: number;
    name: string;
    msg: string;
}

(async () => {
    try {
        if (!envVars.LOGGER_NAME) {
            throw new Error("Logger name not defined");
        }

        const dirPath = join(LOG_DIR, envVars.TOKEN_SYMBOL.toLowerCase(), envVars.LOGGER_NAME);
        try {
            await access(dirPath);
        } catch {
            throw new Error(`Logs for task '${envVars.LOGGER_NAME}' not found`);
        }

        const fileNames = await readdir(dirPath, "utf8");
        const logLevelLabels = logger.levels.labels;

        for (const fileName of fileNames) {
            const filePath = join(dirPath, fileName);
            const fileStream = createReadStream(filePath);
            const lines = createInterface({ input: fileStream });

            for await (const line of lines) {
                const { level, time, msg }: LogEntry = JSON.parse(line);

                const methodName = logLevelLabels[level] as LOG_LEVEL;
                if (typeof logger[methodName] !== "function") {
                    throw new Error(`Logger method not callable: ${methodName}`);
                }
                logger[methodName]({ time }, msg);
            }
        }

        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
