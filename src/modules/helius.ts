import { Helius, HeliusCluster, RpcClient } from "helius-sdk";
import { formatUri } from "../helpers/format";

export type HeliusClient = RpcClient;

export function createHeliusClient(uri: string, cluster: HeliusCluster): HeliusClient {
    const { searchParams } = new URL(uri);
    const apiKey = searchParams.get("api-key");
    if (!apiKey) {
        throw new Error(`API key not found for URI: ${formatUri(uri)}`);
    }

    return new Helius(apiKey, cluster).rpc;
}
