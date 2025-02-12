import {
    ApiV3PoolInfoStandardItemCpmm,
    CpmmKeys,
    CpmmRpcData,
    CREATE_CPMM_POOL_PROGRAM,
    DEV_CREATE_CPMM_POOL_PROGRAM,
    Raydium,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CLUSTER } from "../modules";

export interface CpmmPoolInfo {
    poolInfo: ApiV3PoolInfoStandardItemCpmm;
    poolKeys?: CpmmKeys;
    baseReserve: BN;
    quoteReserve: BN;
    tradeFee: BN;
}

export async function loadRaydium(connection: Connection, owner?: Keypair): Promise<Raydium> {
    if (connection.rpcEndpoint === clusterApiUrl("mainnet-beta")) {
        throw new Error(`Public mainnet RPC not allowed: ${connection.rpcEndpoint}`);
    }

    return Raydium.load({
        connection,
        cluster: CLUSTER === "mainnet-beta" ? "mainnet" : CLUSTER,
        owner,
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "confirmed",
        apiRequestInterval: 0,
        apiRequestTimeout: 30_000,
    });
}

export async function loadRaydiumPoolInfo(
    connection: Connection,
    poolId: PublicKey,
    mint: Keypair
): Promise<CpmmPoolInfo> {
    const raydium = await loadRaydium(connection);
    let poolInfo: ApiV3PoolInfoStandardItemCpmm;
    let poolKeys: CpmmKeys | undefined;
    let rpcData: CpmmRpcData;
    let programId: string;

    if (raydium.cluster === "devnet") {
        const data = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
        poolInfo = data.poolInfo;
        poolKeys = data.poolKeys;
        rpcData = data.rpcData;
        programId = DEV_CREATE_CPMM_POOL_PROGRAM.toBase58();
    } else {
        const results = await Promise.all([
            raydium.api.fetchPoolById({ ids: poolId.toBase58() }),
            raydium.cpmm.getRpcPoolInfo(poolId.toBase58(), true),
        ]);
        poolInfo = results[0][0] as ApiV3PoolInfoStandardItemCpmm;
        rpcData = results[1];
        programId = CREATE_CPMM_POOL_PROGRAM.toBase58();
    }

    if (programId !== poolInfo.programId) {
        throw new Error(`Not Raydium CPMM pool. Program id: ${poolInfo.programId}`);
    }

    const poolMints = [NATIVE_MINT.toBase58(), mint.publicKey.toBase58()];
    if (
        !poolMints.includes(poolInfo.mintA.address) ||
        !poolMints.includes(poolInfo.mintB.address)
    ) {
        throw new Error(
            `Invalid mints in Raydium pool: ${poolInfo.mintA.address}/${poolInfo.mintB.address}`
        );
    }

    if (typeof rpcData.configInfo === "undefined") {
        throw new Error("Missing Raydium config info");
    }

    return {
        poolInfo,
        poolKeys,
        baseReserve: rpcData.baseReserve,
        quoteReserve: rpcData.quoteReserve,
        tradeFee: rpcData.configInfo.tradeFeeRate,
    };
}
