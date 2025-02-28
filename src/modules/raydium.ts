import {
    ApiV3PoolInfoStandardItemCpmm,
    CpmmKeys,
    CpmmRpcData,
    CREATE_CPMM_POOL_PROGRAM,
    CurveCalculator,
    DEV_CREATE_CPMM_POOL_PROGRAM,
    Raydium,
    SwapResult,
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
import { PriorityLevel } from "helius-sdk";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    ContractErrors,
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
    TransactionOptions,
} from "../helpers/network";
import { envVars, logger, UNITS_PER_MINT } from "../modules";
import { HeliusClient } from "./helius";
import { Pool } from "./pool";

export interface RaydiumCpmmPool {
    poolInfo: ApiV3PoolInfoStandardItemCpmm;
    poolKeys?: CpmmKeys;
    baseReserve: BN;
    quoteReserve: BN;
    tradeFee: BN;
}

export const RAYDIUM_POOL_ERRORS: ContractErrors = {
    2012: {
        instruction: "SwapBaseInput",
        code: "ContraintAddress",
        message: "Address constraint violated",
    },
    6000: {
        instruction: "SwapBaseInput",
        code: "NotApproved",
        message: "Not approved",
    },
};

export async function createRaydium(connection: Connection, owner?: Keypair): Promise<Raydium> {
    if (connection.rpcEndpoint === clusterApiUrl("mainnet-beta")) {
        throw new Error(`Public mainnet RPC not allowed: ${connection.rpcEndpoint}`);
    }

    return Raydium.load({
        connection,
        cluster: envVars.RPC_CLUSTER === "mainnet-beta" ? "mainnet" : envVars.RPC_CLUSTER,
        owner,
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: connection.commitment,
        apiRequestInterval: 0,
        apiRequestTimeout: 30_000,
    });
}

export async function loadRaydiumCpmmPool(
    raydium: Raydium,
    poolId: PublicKey
): Promise<RaydiumCpmmPool> {
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
        throw new Error(`Invalid program id for Raydium CPMM pool: ${poolInfo.programId}`);
    }
    if (!rpcData.configInfo) {
        throw new Error("Missing config for Raydium CPMM pool");
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
    raydium: Raydium,
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: RaydiumCpmmPool,
    accounts: (Keypair | null)[],
    lamportsToSwap: (BN | null)[],
    slippage: number,
    priorityLevel: PriorityLevel,
    transactionOptions?: TransactionOptions
): Promise<Promise<TransactionSignature | undefined>[]> {
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;
    const computeBudgetInstructions: TransactionInstruction[] = [];
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];

    for (const [i, account] of accounts.entries()) {
        if (account === null || lamportsToSwap[i] === null) {
            continue;
        }

        const connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        let swapResult: SwapResult | null;
        try {
            swapResult = CurveCalculator.swap(
                lamportsToSwap[i],
                baseIn ? baseReserve : quoteReserve,
                baseIn ? quoteReserve : baseReserve,
                tradeFee
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.message === "destinationAmountSwapped is zero") {
                logger.warn(
                    "Account (%s) has too low amount to swap: %s SOL",
                    formatPublicKey(account.publicKey),
                    formatDecimal(
                        new Decimal(lamportsToSwap[i].toString(10)).div(LAMPORTS_PER_SOL)
                    ),
                    envVars.TOKEN_SYMBOL
                );
                continue;
            }

            throw error;
        }

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            UNITS_PER_MINT
        );

        const {
            transaction: { instructions },
        } = await raydium.setOwner(account).cpmm.swap<TxVersion.LEGACY>({
            poolInfo,
            poolKeys,
            inputAmount: lamportsToSwap[i],
            swapResult,
            slippage,
            baseIn,
        });

        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    envVars.RPC_CLUSTER,
                    heliusClient,
                    priorityLevel,
                    instructions,
                    [account]
                ))
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [account],
                `to swap ${formatDecimal(sourceAmount)} WSOL to ~${formatDecimal(destinationAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} for account (${formatPublicKey(account.publicKey)})`,
                transactionOptions
            )
        );
    }

    return sendTransactions;
}

export async function swapMintToSol(
    connectionPool: Pool<Connection>,
    heliusClientPool: Pool<HeliusClient>,
    raydium: Raydium,
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: RaydiumCpmmPool,
    accounts: (Keypair | null)[],
    unitsToSwap: (BN | null)[],
    slippage: number,
    priorityLevel: PriorityLevel,
    transactionOptions?: TransactionOptions
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    const computeBudgetInstructions: TransactionInstruction[] = [];
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintB.address;

    for (const [i, account] of accounts.entries()) {
        if (account === null || unitsToSwap[i] === null) {
            continue;
        }

        const connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        let swapResult: SwapResult | null;
        try {
            swapResult = CurveCalculator.swap(
                unitsToSwap[i],
                baseIn ? baseReserve : quoteReserve,
                baseIn ? quoteReserve : baseReserve,
                tradeFee
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.message === "destinationAmountSwapped is zero") {
                logger.warn(
                    "Account (%s) has too low amount to swap: %s %s",
                    formatPublicKey(account.publicKey),
                    formatDecimal(
                        new Decimal(unitsToSwap[i].toString(10)).div(UNITS_PER_MINT),
                        envVars.TOKEN_DECIMALS
                    ),
                    envVars.TOKEN_SYMBOL
                );
                continue;
            }

            throw error;
        }

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            UNITS_PER_MINT
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );

        const {
            transaction: { instructions },
        } = await raydium.setOwner(account).cpmm.swap<TxVersion.LEGACY>({
            poolInfo,
            poolKeys,
            inputAmount: unitsToSwap[i],
            swapResult,
            slippage,
            baseIn,
            payer: account.publicKey,
        });

        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    envVars.RPC_CLUSTER,
                    heliusClient,
                    priorityLevel,
                    instructions,
                    [account]
                ))
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [account],
                `to swap ${formatDecimal(sourceAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} to ~${formatDecimal(destinationAmount)} WSOL for account (${formatPublicKey(account.publicKey)})`,
                transactionOptions
            )
        );
    }

    return sendTransactions;
}
