import { Cluster, clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";

export async function loadRaydium(
    cluster: Cluster,
    connection: Connection,
    owner?: Keypair
): Promise<Raydium> {
    if (cluster !== "devnet" && cluster !== "mainnet-beta") {
        throw new Error(`Cluster not supported by Raydium: ${cluster}`);
    }
    if (connection.rpcEndpoint === clusterApiUrl("mainnet-beta")) {
        throw new Error(`Free public RPC not allowed: ${connection.rpcEndpoint}`);
    }

    return Raydium.load({
        cluster: cluster === "mainnet-beta" ? "mainnet" : cluster,
        connection,
        owner,
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "confirmed",
    });
}
