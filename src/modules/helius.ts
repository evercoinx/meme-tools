import { Helius, HeliusCluster, RpcClient } from "helius-sdk";

export type HeliusClient = RpcClient;

export function createHeliusClient(url: string, cluster: HeliusCluster): HeliusClient {
    const { searchParams } = new URL(url);
    const apiKey = searchParams.get("api-key");
    if (!apiKey) {
        throw new Error(`API key not found for URL: ${url}`);
    }

    return new Helius(apiKey, cluster).rpc;
}
