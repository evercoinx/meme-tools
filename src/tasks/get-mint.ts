import { getMint as getMintInfo, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importMintKeypair } from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import {
    formatDecimal,
    formatError,
    formatInteger,
    formatText,
    formatPublicKey,
    OUTPUT_NOT_ALLOWED,
} from "../helpers/format";
import { connectionPool, envVars, explorer, logger, storage } from "../modules";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        await getMint(mint);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function getMint(mint: Keypair): Promise<void> {
    const mintInfo = await getMintInfo(
        connectionPool.get(),
        mint.publicKey,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
    );

    const supply = new Decimal(mintInfo.supply.toString(10)).div(10 ** mintInfo.decimals);

    logger.info(
        "Mint (%s)\n\t\tAddress: %s\n\t\tSymbol: %s\n\t\tDecimals: %s\n\t\tSupply: %s\n\t\tMint authority: %s\n\t\tFreeze authority: %s",
        envVars.RPC_CLUSTER,
        explorer.generateTokenUri(mintInfo.address, mintInfo.address.toBase58()),
        formatText(envVars.TOKEN_SYMBOL),
        formatInteger(mintInfo.decimals),
        formatDecimal(supply, mintInfo.decimals),
        mintInfo.mintAuthority
            ? formatPublicKey(mintInfo.mintAuthority, "long")
            : OUTPUT_NOT_ALLOWED,
        mintInfo.freezeAuthority
            ? formatPublicKey(mintInfo.freezeAuthority, "long")
            : OUTPUT_NOT_ALLOWED
    );
}
