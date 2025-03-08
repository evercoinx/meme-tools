import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Keypair } from "@solana/web3.js";
import { KEYPAIR_FILE_EXTENSION } from "../helpers/account";
import { findFileNames } from "../helpers/filesystem";
import { formatError, formatFileName, formatInteger } from "../helpers/format";
import { KEYPAIR_DIR, logger } from "../modules";

const BASE58_CHARACTER_SET = /^[1-9A-HJ-NP-Za-km-z]+$/;

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

        if (prefix && !BASE58_CHARACTER_SET.test(prefix)) {
            throw new Error("Prefix must contain only base58 characters");
        }

        if (postfix && !BASE58_CHARACTER_SET.test(postfix)) {
            throw new Error("Postfix must contain only base58 characters");
        }

        const parsedAttempts = parseInt(attempts);
        if (parsedAttempts > 500_000) {
            throw new Error(`Too many attempts: ${parsedAttempts}`);
        }

        await grindKeypair(KEYPAIR_DIR, prefix, postfix, KEYPAIR_FILE_EXTENSION, parsedAttempts);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function grindKeypair(
    dirPath: string,
    prefix: string,
    postfix: string,
    extension: string,
    attempts: number
) {
    const keypairDir = await mkdir(KEYPAIR_DIR, {
        mode: 0o700,
        recursive: true,
    });
    if (keypairDir) {
        logger.warn("Key pair directory created: %s", formatFileName(keypairDir));
    }

    const keypairFileNames = await findFileNames(
        KEYPAIR_DIR,
        prefix,
        postfix,
        KEYPAIR_FILE_EXTENSION
    );
    if (keypairFileNames.length >= 1) {
        logger.warn("Keypair already ground: %s", formatFileName(keypairFileNames[0]));
        return;
    }

    for (let i = 0; i < attempts; i++) {
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();

        if (
            (prefix && !publicKey.startsWith(prefix)) ||
            (postfix && !publicKey.endsWith(postfix))
        ) {
            continue;
        }

        const fileName = `${publicKey}${extension}`;
        await writeFile(join(dirPath, fileName), JSON.stringify(Array.from(keypair.secretKey)), {
            mode: 0o400,
        });
        logger.info("Keypair ground: %s", formatFileName(fileName));
        return;
    }

    throw new Error(`Failed to grind keypair. Attempts: ${formatInteger(attempts)}`);
}
