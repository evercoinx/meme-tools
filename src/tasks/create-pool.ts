import path from "node:path";
import {
    ApiV3PoolInfoStandardItemCpmm,
    ApiV3Token,
    CpmmKeys,
    CpmmRpcData,
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    CurveCalculator,
    DEV_CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_DIR,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { loadRaydium } from "../modules/raydium";
import { importDevKeypair, importHolderKeypairs, importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { checkIfFileExists } from "../helpers/filesystem";
import { getWrapSolInsturctions, sendAndConfirmVersionedTransaction } from "../helpers/network";

type Token = Pick<ApiV3Token, "address" | "programId" | "symbol" | "name" | "decimals">;

const SLIPPAGE = 0.15;

(async () => {
    try {
        if (!["devnet", "mainnet-beta"].includes(envVars.CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.CLUSTER}`);
        }

        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);
        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const holders = importHolderKeypairs();
        if (holders.length === 0) {
            throw new Error("Holders not imported");
        }

        const raydiumPoolId = await createPool(dev, mint);
        const amount = new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(
            envVars.HOLDER_SHARE_POOL_PERCENT
        );
        await swapSolToTokenByHolders(raydiumPoolId, amount, holders, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function createPool(dev: Keypair, mint: Keypair): Promise<string> {
    let raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.info("Raydium pool id %s loaded from storage", raydiumPoolId);
        return raydiumPoolId;
    }

    const raydium = await loadRaydium(envVars.CLUSTER, connection, dev);

    const feeConfigs = await raydium.api.getCpmmConfigs();
    if (feeConfigs.length === 0) {
        throw new Error("No CPMM fee configs found");
    }
    feeConfigs.sort((a, b) => a.tradeFeeRate - b.tradeFeeRate);

    const feeConfig = feeConfigs[0];
    if (raydium.cluster === "devnet") {
        const id = getCpmmPdaAmmConfigId(
            DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
            feeConfig.index
        );
        feeConfig.id = id.publicKey.toBase58();
    }

    const [wrapSolInstructions] = await getWrapSolInsturctions(
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL),
        dev
    );

    const mintA: Token = {
        address: NATIVE_MINT.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
        symbol: "WSOL",
        name: "Wrapped SOL",
        decimals: 9,
    };
    const mintB: Token = {
        address: mint.publicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        symbol: envVars.TOKEN_SYMBOL,
        name: envVars.TOKEN_SYMBOL,
        decimals: envVars.TOKEN_DECIMALS,
    };

    const {
        transaction: { instructions: createPoolInstructions },
        extInfo: {
            address: { poolId, lpMint },
        },
    } = await raydium.cpmm.createPool<TxVersion.LEGACY>({
        programId:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
                : CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
                : CREATE_CPMM_POOL_FEE_ACC,
        mintA,
        mintB,
        mintAAmount: new BN(
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL).toFixed(0)
        ),
        mintBAmount: new BN(
            new Decimal(envVars.TOKEN_SUPPLY)
                .mul(10 ** envVars.TOKEN_DECIMALS)
                .mul(envVars.INITIAL_POOL_SIZE_PERCENT)
                .toFixed(0)
        ),
        startTime: new BN(0),
        feeConfig,
        associatedOnly: true,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    raydiumPoolId = poolId.toBase58();
    await sendAndConfirmVersionedTransaction(
        [...wrapSolInstructions, ...createPoolInstructions],
        [dev],
        `to create pool ${raydiumPoolId}`
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, raydiumPoolId);
    storage.set(STORAGE_RAYDIUM_LP_MINT, lpMint.toBase58());
    storage.save();
    logger.debug(
        "Raydium pool id %s saved to storage\n\t\tRaydium LP mint %s saved to storage",
        raydiumPoolId,
        lpMint.toBase58()
    );

    return raydiumPoolId;
}

async function swapSolToTokenByHolders(
    raydiumPoolId: string,
    amount: Decimal,
    holders: Keypair[],
    mint: Keypair
): Promise<void> {
    const raydium = await loadRaydium(envVars.CLUSTER, connection);
    let poolInfo: ApiV3PoolInfoStandardItemCpmm;
    let poolKeys: CpmmKeys | undefined;
    let rpcData: CpmmRpcData;

    if (raydium.cluster === "devnet") {
        const data = await raydium.cpmm.getPoolInfoFromRpc(raydiumPoolId);
        poolInfo = data.poolInfo;
        if (poolInfo.programId !== DEV_CREATE_CPMM_POOL_PROGRAM.toBase58()) {
            throw new Error(`Not CPMM pool. Program id: ${poolInfo.programId}`);
        }
        poolKeys = data.poolKeys;
        rpcData = data.rpcData;
    } else {
        const data = await raydium.api.fetchPoolById({ ids: raydiumPoolId });
        poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm;
        if (poolInfo.programId !== CREATE_CPMM_POOL_PROGRAM.toBase58()) {
            throw new Error(`Not CPMM pool. Program id: ${poolInfo.programId}`);
        }
        rpcData = await raydium.cpmm.getRpcPoolInfo(poolInfo.id, true);
    }

    if (typeof rpcData.configInfo === "undefined") {
        throw new Error("Missing config info");
    }

    const poolPairAddresses = [NATIVE_MINT.toBase58(), mint.publicKey.toBase58()];
    if (
        !poolPairAddresses.includes(poolInfo.mintA.address) ||
        !poolPairAddresses.includes(poolInfo.mintB.address)
    ) {
        throw new Error(`Invalid pool: ${poolInfo.mintA.address}/${poolInfo.mintB.address}`);
    }

    const lamportsToSwap = new BN(amount.mul(LAMPORTS_PER_SOL).toFixed(0));
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;

    const swapResult = CurveCalculator.swap(
        lamportsToSwap,
        baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
        baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
        rpcData.configInfo.tradeFeeRate
    );
    const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10));
    const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10));

    const transactions: Promise<void>[] = [];
    for (const holder of holders) {
        const associatedTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            holder.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let balance = new Decimal(0);
        try {
            const tokenAccountBalance = await connection.getTokenAccountBalance(
                associatedTokenAccount,
                "confirmed"
            );
            balance = new Decimal(tokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (balance.gt(0)) {
            logger.warn(
                "Holder %s has non zero token balance: %s",
                holder.publicKey.toBase58(),
                formatDecimal(balance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        const raydium = await loadRaydium(envVars.CLUSTER, connection, holder);
        const {
            transaction: { instructions },
        } = await raydium.cpmm.swap<TxVersion.LEGACY>({
            poolInfo,
            poolKeys,
            inputAmount: lamportsToSwap,
            swapResult,
            slippage: SLIPPAGE,
            baseIn,
        });

        transactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [holder],
                `to swap ${formatDecimal(sourceAmount.div(LAMPORTS_PER_SOL))} WSOL for ${formatDecimal(destinationAmount.div(10 ** envVars.TOKEN_DECIMALS), envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} for ${holder.publicKey.toBase58()}`
            )
        );
    }

    await Promise.all(transactions);
}
