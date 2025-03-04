import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Keypair } from "@solana/web3.js";
import { countFiles } from "../helpers/filesystem";
import { formatFileName, formatInteger } from "../helpers/format";
import { KEYPAIR_DIR, logger } from "../modules";

(async () => {
    try {
        const {
            values: { prefix, postfix, attempts },
        } = parseArgs({
            options: {
                prefix: {
                    type: "string",
                    default: "",
                },
                postfix: {
                    type: "string",
                    default: "",
                },
                attempts: {
                    type: "string",
                    default: "200000",
                },
            },
        });

        const parsedAttempts = parseInt(attempts);
        if (parsedAttempts > 500_000) {
            throw new Error("Too many attempts");
        }

        await generateKeypair(KEYPAIR_DIR, prefix, postfix, parsedAttempts);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function generateKeypair(dirPath: string, prefix: string, postfix: string, attempts: number) {
    for (let i = 0; i < attempts; i++) {
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        if (
            (prefix && !publicKey.startsWith(prefix)) ||
            (postfix && !publicKey.endsWith(postfix))
        ) {
            continue;
        }

        await mkdir(dirPath, { recursive: true });

        const fileExtension = ".json";
        const fileCount = await countFiles(dirPath, [fileExtension]);
        if (fileCount >= 2) {
            logger.warn("Keypair already generated");
            return;
        }

        const fileName = `${publicKey}${fileExtension}`;
        const filePath = join(dirPath, fileName);

        await writeFile(filePath, JSON.stringify(Array.from(keypair.secretKey)), {
            mode: 0o400,
        });
        logger.info("Keypair generated: %s", formatFileName(fileName));
        return;
    }

    throw new Error(`Failed to generate keypair. Attempts: ${formatInteger(attempts)}`);
}
