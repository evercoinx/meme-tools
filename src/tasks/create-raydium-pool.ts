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
    createBurnInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { loadRaydium } from "../modules/raydium";
import {
    importDevKeypair,
    importHolderKeypairs,
    importMintKeypair,
    importRaydiumLpMintPublicKey,
    importRaydiumPoolId,
} from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal } from "../helpers/format";
import { getWrapSolInsturctions, sendAndConfirmVersionedTransaction } from "../helpers/network";

type Token = Pick<ApiV3Token, "address" | "programId" | "symbol" | "name" | "decimals">;

const SLIPPAGE = 0.15;

(async () => {
    try {
        if (!["devnet", "mainnet-beta"].includes(envVars.CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.CLUSTER}`);
        }

        await checkIfStorageExists();

        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);
        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const holders = importHolderKeypairs();
        if (holders.length === 0) {
            throw new Error("Holders not imported");
        }

        const amounts = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(percent)
        );
        if (holders.length !== amounts.length) {
            throw new Error(
                `Holders count and their shares mismatch: ${holders.length} != ${amounts.length}`
            );
        }

        const [poolId, lpMintPublicKey] = await createPool(dev, mint);
        await swapSolToToken(poolId, amounts, holders, mint);
        await burnLpMint(lpMintPublicKey, dev);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function createPool(dev: Keypair, mint: Keypair): Promise<[PublicKey, PublicKey]> {
    const poolId = importRaydiumPoolId();
    if (poolId) {
        logger.debug("Raydium pool id %s loaded from storage", poolId);

        const lpMintPublicKey = importRaydiumLpMintPublicKey();
        if (!lpMintPublicKey) {
            throw new Error("LP mint not imported");
        }
        logger.debug("LP mint %s loaded from storage", lpMintPublicKey);

        return [new PublicKey(poolId), new PublicKey(lpMintPublicKey)];
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
        extInfo: { address },
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

    await sendAndConfirmVersionedTransaction(
        [...wrapSolInstructions, ...createPoolInstructions],
        [dev],
        `to create pool ${address.poolId}`
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, address.poolId);
    logger.debug("Raydium pool id %s saved to storage", address.poolId);
    storage.set(STORAGE_RAYDIUM_LP_MINT, address.lpMint.toBase58());
    logger.debug("Raydium LP mint %s saved to storage", address.lpMint.toBase58());
    storage.save();

    return [address.poolId, address.lpMint];
}

async function burnLpMint(lpMintPublicKey: PublicKey, dev: Keypair): Promise<void> {
    const lpMintAssociatedTokenAccount = getAssociatedTokenAddressSync(
        lpMintPublicKey,
        dev.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const mintTokenAccountBalance = await connection.getTokenAccountBalance(
        lpMintAssociatedTokenAccount,
        "confirmed"
    );
    const lpMintBalance = new Decimal(mintTokenAccountBalance.value.amount);
    if (lpMintBalance.lte(0)) {
        logger.warn(`LP mint ${lpMintPublicKey} already burned`);
        return;
    }

    const instructions = [
        createBurnInstruction(
            lpMintAssociatedTokenAccount,
            lpMintPublicKey,
            dev.publicKey,
            lpMintBalance.toNumber(),
            [],
            TOKEN_PROGRAM_ID
        ),
    ];

    await sendAndConfirmVersionedTransaction(
        instructions,
        [dev],
        `to burn LP mint ${lpMintPublicKey.toBase58()}`
    );
}

async function swapSolToToken(
    poolId: PublicKey,
    amounts: Decimal[],
    holders: Keypair[],
    mint: Keypair
): Promise<void> {
    const raydium = await loadRaydium(envVars.CLUSTER, connection);
    let poolInfo: ApiV3PoolInfoStandardItemCpmm;
    let poolKeys: CpmmKeys | undefined;
    let rpcData: CpmmRpcData;

    if (raydium.cluster === "devnet") {
        const data = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
        poolInfo = data.poolInfo;
        if (poolInfo.programId !== DEV_CREATE_CPMM_POOL_PROGRAM.toBase58()) {
            throw new Error(`Not CPMM pool. Program id: ${poolInfo.programId}`);
        }
        poolKeys = data.poolKeys;
        rpcData = data.rpcData;
    } else {
        const data = await raydium.api.fetchPoolById({ ids: poolId.toBase58() });
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

    const transactions: Promise<void>[] = [];
    for (const [i, holder] of holders.entries()) {
        const lamportsToSwap = new BN(amounts[i].mul(LAMPORTS_PER_SOL).toFixed(0));
        const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;

        const swapResult = CurveCalculator.swap(
            lamportsToSwap,
            baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
            baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
            rpcData.configInfo.tradeFeeRate
        );

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10));
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10));
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
