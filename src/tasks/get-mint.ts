import { getMint as getMintInfo, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import Decimal from "decimal.js";
import pc from "picocolors";
import { importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { CLUSTER, connectionPool, envVars, logger, storage } from "../modules";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        await getMint(mint);
        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getMint(mint: Keypair): Promise<void> {
    const mintInfo = await getMintInfo(
        connectionPool.next(),
        mint.publicKey,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
    );

    const supply = new Decimal(mintInfo.supply.toString(10)).div(10 ** mintInfo.decimals);

    logger.info(
        "Mint (%s)\n\t\tAddress: %s\n\t\tSymbol: %s\n\t\tDecimals: %s\n\t\tSupply: %s\n\t\tMint authority: %s\n\t\tFreeze authority: %s",
        CLUSTER,
        formatPublicKey(mintInfo.address, "long"),
        pc.yellow(envVars.TOKEN_SYMBOL),
        formatDecimal(mintInfo.decimals, 0),
        formatDecimal(supply, mintInfo.decimals),
        mintInfo.mintAuthority ? formatPublicKey(mintInfo.mintAuthority, "long") : pc.red("n/a"),
        mintInfo.freezeAuthority ? formatPublicKey(mintInfo.freezeAuthority, "long") : pc.red("n/a")
    );
}
