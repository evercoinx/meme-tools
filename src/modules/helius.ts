import { Helius, HeliusCluster, RpcClient } from "helius-sdk";

export type HeliusClient = RpcClient;

export function createHeliusClient(uri: string, cluster: HeliusCluster): HeliusClient {
    const { searchParams } = new URL(uri);
    const apiKey = searchParams.get("api-key");
    return new Helius(apiKey ?? uri, cluster).rpc;
}
