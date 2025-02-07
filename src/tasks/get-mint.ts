import { getMint as getMintInfo, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import Decimal from "decimal.js";
import { importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { checkIfStorageExists } from "../helpers/validation";
import { connection, envVars, logger } from "../modules";

(async () => {
    try {
        await checkIfStorageExists();

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        await getMint(mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getMint(mint: Keypair): Promise<void> {
    const mintInfo = await getMintInfo(
        connection,
        mint.publicKey,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
    );

    const supply = new Decimal(mintInfo.supply.toString(10)).div(10 ** mintInfo.decimals);

    logger.info(
        "Mint (%s)\n\t\tAddress: %s\n\t\tSymbol: %s\n\t\tDecimals: %d\nt\tSupply: %s\n\t\tMint authority: %s\n\t\tFreeze authority: %s",
        envVars.CLUSTER,
        mintInfo.address,
        mintInfo.decimals,
        formatDecimal(supply, mintInfo.decimals),
        mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : "n/a",
        mintInfo.freezeAuthority ? mintInfo.freezeAuthority.toBase58() : "n/a"
    );
}
