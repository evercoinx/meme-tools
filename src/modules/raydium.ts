import { Cluster, clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";

export async function loadRaydium(
    connection: Connection,
    cluster: Cluster,
    owner?: Keypair
): Promise<Raydium> {
    if (cluster !== "devnet" && cluster !== "mainnet-beta") {
        throw new Error(`Cluster not supported by Raydium: ${cluster}`);
    }
    if (connection.rpcEndpoint === clusterApiUrl("mainnet-beta")) {
        throw new Error(`Public mainnet RPC not allowed: ${connection.rpcEndpoint}`);
    }

    return Raydium.load({
        connection,
        cluster: cluster === "mainnet-beta" ? "mainnet" : cluster,
        owner,
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "confirmed",
        apiRequestInterval: 0,
        apiRequestTimeout: 30_000,
    });
}
