import {
    ApiV3PoolInfoStandardItemCpmm,
    CpmmKeys,
    CpmmRpcData,
    CREATE_CPMM_POOL_PROGRAM,
    CurveCalculator,
    DEV_CREATE_CPMM_POOL_PROGRAM,
    Raydium,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeUnitPriceInstruction,
    sendAndConfirmVersionedTransaction,
    TransactionOptions,
} from "../helpers/network";
import { CLUSTER, envVars } from "../modules";
import { HeliusClient, PriorityLevel } from "./helius";
import { Pool } from "./pool";

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

    if (!rpcData.configInfo) {
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

export async function swapSolToMint(
    connectionPool: Pool<Connection>,
    heliusClientPool: Pool<HeliusClient>,
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    accounts: (Keypair | null)[],
    lamportsToSwap: (BN | null)[],
    slippage: number,
    priorityLevel: PriorityLevel,
    transactionOptions?: TransactionOptions
): Promise<Promise<TransactionSignature | undefined>[]> {
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;
    let computePriceInstruction: TransactionInstruction | undefined;
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];

    for (const [i, account] of accounts.entries()) {
        if (account === null || lamportsToSwap[i] === null) {
            continue;
        }

        const connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        const swapResult = CurveCalculator.swap(
            lamportsToSwap[i],
            baseIn ? baseReserve : quoteReserve,
            baseIn ? quoteReserve : baseReserve,
            tradeFee
        );

        const raydium = await loadRaydium(connection, account);
        const {
            transaction: { instructions },
        } = await raydium.cpmm.swap<TxVersion.LEGACY>({
            poolInfo,
            poolKeys,
            inputAmount: lamportsToSwap[i],
            swapResult,
            slippage,
            baseIn,
        });

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            10 ** envVars.TOKEN_DECIMALS
        );

        if (!computePriceInstruction) {
            computePriceInstruction = await getComputeUnitPriceInstruction(
                connection,
                heliusClient,
                priorityLevel,
                instructions,
                account
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [computePriceInstruction, ...instructions],
                [account],
                `to swap ${formatDecimal(sourceAmount)} WSOL to ~${formatDecimal(destinationAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} for account #${i} (${formatPublicKey(account.publicKey)})`,
                transactionOptions
            )
        );
    }

    return sendTransactions;
}

export async function swapMintToSol(
    connectionPool: Pool<Connection>,
    heliusClientPool: Pool<HeliusClient>,
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    accounts: (Keypair | null)[],
    unitsToSwap: (BN | null)[],
    slippage: number,
    priorityLevel: PriorityLevel,
    transactionOptions?: TransactionOptions
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    let computePriceInstruction: TransactionInstruction | undefined;
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintB.address;

    for (const [i, account] of accounts.entries()) {
        if (unitsToSwap[i] === null || account === null) {
            continue;
        }

        const connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        const swapResult = CurveCalculator.swap(
            unitsToSwap[i],
            baseIn ? baseReserve : quoteReserve,
            baseIn ? quoteReserve : baseReserve,
            tradeFee
        );

        const raydium = await loadRaydium(connection, account);
        const {
            transaction: { instructions },
        } = await raydium.cpmm.swap<TxVersion.LEGACY>({
            poolInfo,
            poolKeys,
            inputAmount: unitsToSwap[i],
            swapResult,
            slippage,
            baseIn,
        });

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            10 ** envVars.TOKEN_DECIMALS
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );

        if (!computePriceInstruction) {
            computePriceInstruction = await getComputeUnitPriceInstruction(
                connection,
                heliusClient,
                priorityLevel,
                instructions,
                account
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [computePriceInstruction, ...instructions],
                [account],
                `to swap ${formatDecimal(sourceAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} to ~${formatDecimal(destinationAmount)} WSOL for account #${i} (${formatPublicKey(account.publicKey)})`,
                transactionOptions
            )
        );
    }

    return sendTransactions;
}
