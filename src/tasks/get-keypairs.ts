import { join } from "node:path";
import fs from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { encryption, logger } from "../modules";
import { formatError, formatFileName, formatText } from "../helpers/format";

const KEYPAIR_DIR = "./data/keypairs";

(async () => {
    try {
        const files = await fs.readdir(KEYPAIR_DIR);

        for (const file of files) {
            if (!file.endsWith(".json")) {
                continue;
            }

            const filePath = join(KEYPAIR_DIR, file);
            const secretKey: number[] = JSON.parse(await fs.readFile(filePath, "utf8"));
            if (secretKey.length !== 64) {
                logger.warn("Skipped invalid secret key file: %s", file);
                continue;
            }

            const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

            logger.info(
                "%s\n%s\n%s",
                formatFileName(file),
                formatText(bs58.encode(keypair.secretKey)),
                encryption.encrypt(keypair.secretKey)
            );
        }

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();
