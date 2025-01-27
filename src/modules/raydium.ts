import { Connection, Keypair } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";

export async function loadRaydium(
    cluster: string,
    connection: Connection,
    owner: Keypair
): Promise<Raydium> {
    if (cluster !== "devnet" && cluster !== "mainnet") {
        throw new Error(`Cluster ${cluster} not supported`);
    }

    return Raydium.load({
        cluster,
        connection,
        owner,
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "finalized",
    });
}
