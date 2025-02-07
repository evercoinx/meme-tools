import {
    ApiV3PoolInfoStandardItemCpmm,
    ApiV3Token,
    CpmmKeys,
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    CurveCalculator,
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
import { importHolderKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { getWrapSolInstructions, sendAndConfirmVersionedTransaction } from "../helpers/network";
import { checkIfStorageExists, checkIfSupportedByRaydium } from "../helpers/validation";
import {
    connection,
    envVars,
    logger,
    prioritizationFees,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { CpmmPoolInfo, loadRaydium, loadRaydiumPoolInfo } from "../modules/raydium";

const SLIPPAGE = 0.15;

(async () => {
    try {
        checkIfSupportedByRaydium(envVars.CLUSTER);

        await checkIfStorageExists();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const holders = importHolderKeypairs(envVars.HOLDER_SHARE_POOL_PERCENTS.length);
        const amounts = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(percent)
        );
        const eligibleHolders = await findEligibleHolders(holders, mint);

        const [sendCreatePoolTransaction, poolInfo] = await createPool(dev, mint);

        const sendSwapSolToTokenTransactions = await swapSolToToken(
            poolInfo,
            amounts,
            eligibleHolders
        );
        const sendBurnLpMintTransaction = await burnLpMint(
            new PublicKey(poolInfo.poolInfo.lpMint.address),
            dev
        );

        await prioritizationFees.fetchFees();

        await Promise.all([sendCreatePoolTransaction]);
        await Promise.all([...sendSwapSolToTokenTransactions, sendBurnLpMintTransaction]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findEligibleHolders(holders: Keypair[], mint: Keypair): Promise<(Keypair | null)[]> {
    const eligibleHolders: (Keypair | null)[] = [];

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
            eligibleHolders.push(null);

            logger.warn(
                "Holder %s not eligible. His token balance: %s",
                holder.publicKey.toBase58(),
                formatDecimal(balance.div(10 ** envVars.TOKEN_DECIMALS))
            );
        } else {
            eligibleHolders.push(holder);
        }
    }

    return eligibleHolders;
}

async function createPool(dev: Keypair, mint: Keypair): Promise<[Promise<void>, CpmmPoolInfo]> {
    const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.debug("Raydium pool id loaded from storage", raydiumPoolId);

        const raydimLpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydimLpMint) {
            throw new Error("LP mint not loaded from storage");
        }
        logger.debug("LP mint %s loaded from storage", raydimLpMint);

        const poolInfo = await loadRaydiumPoolInfo(new PublicKey(raydiumPoolId), mint);
        return [Promise.resolve(), poolInfo];
    }

    const raydium = await loadRaydium(connection, envVars.CLUSTER, dev);

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

    const programId =
        raydium.cluster === "devnet"
            ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
            : CREATE_CPMM_POOL_PROGRAM;

    const mintA = {
        address: NATIVE_MINT.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
        symbol: "WSOL",
        name: "Wrapped SOL",
        decimals: 9,
    } as ApiV3Token;
    const mintB = {
        address: mint.publicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        symbol: envVars.TOKEN_SYMBOL,
        name: envVars.TOKEN_SYMBOL,
        decimals: envVars.TOKEN_DECIMALS,
    } as ApiV3Token;

    const mintAAmount = new BN(
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL).toFixed(0)
    );
    const mintBAmount = new BN(
        new Decimal(envVars.TOKEN_SUPPLY)
            .mul(10 ** envVars.TOKEN_DECIMALS)
            .mul(envVars.INITIAL_POOL_SIZE_PERCENT)
            .toFixed(0)
    );

    const wrapSolInstructions = await getWrapSolInstructions(
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL),
        dev
    );

    const {
        transaction: { instructions: createPoolInstructions },
        extInfo: {
            address: { poolId, lpMint, authority, vaultA, vaultB },
        },
    } = await raydium.cpmm.createPool<TxVersion.LEGACY>({
        programId,
        poolFeeAccount:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
                : CREATE_CPMM_POOL_FEE_ACC,
        mintA,
        mintB,
        mintAAmount,
        mintBAmount,
        startTime: new BN(0),
        feeConfig,
        associatedOnly: true,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    const sendTransaction = sendAndConfirmVersionedTransaction(
        [...wrapSolInstructions, ...createPoolInstructions],
        [dev],
        `to create pool ${poolId.toBase58()}`,
        prioritizationFees.averageFeeExcludingZeros,
        {
            skipPreflight: true,
            preflightCommitment: "single",
        }
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, poolId.toBase58());
    storage.set(STORAGE_RAYDIUM_LP_MINT, lpMint.toBase58());
    storage.save();
    logger.debug("Raydium pool id %s saved to storage", poolId.toBase58());
    logger.debug("Raydium LP mint %s saved to storage", lpMint.toBase58());

    const baseIn = NATIVE_MINT.toBase58() === mintA.address;

    return [
        sendTransaction,
        {
            poolInfo: {
                id: poolId.toBase58(),
                lpMint: {
                    address: lpMint.toBase58(),
                },
                mintA,
                mintB,
                programId: programId.toBase58(),
            } as ApiV3PoolInfoStandardItemCpmm,
            poolKeys: {
                authority: authority.toBase58(),
                vault: {
                    A: vaultA.toBase58(),
                    B: vaultB.toBase58(),
                },
                config: feeConfig,
            } as CpmmKeys,
            baseReserve: baseIn ? mintAAmount : mintBAmount,
            quoteReserve: baseIn ? mintBAmount : mintAAmount,
            tradeFee: new BN(feeConfig.tradeFeeRate),
        },
    ];
}

async function swapSolToToken(
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    amounts: Decimal[],
    holders: (Keypair | null)[]
): Promise<Promise<void>[]> {
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;
    const sendTransactions: Promise<void>[] = [];

    for (const [i, holder] of holders.entries()) {
        if (holder === null) {
            continue;
        }

        const lamportsToSwap = new BN(amounts[i].mul(LAMPORTS_PER_SOL).toFixed(0));

        const swapResult = CurveCalculator.swap(
            lamportsToSwap,
            baseIn ? baseReserve : quoteReserve,
            baseIn ? quoteReserve : baseReserve,
            tradeFee
        );

        const raydium = await loadRaydium(connection, envVars.CLUSTER, holder);
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

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            10 ** envVars.TOKEN_DECIMALS
        );

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [holder],
                `to swap ${formatDecimal(sourceAmount)} WSOL to ~${formatDecimal(destinationAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} for ${holder.publicKey.toBase58()}`,
                prioritizationFees.averageFeeExcludingZeros,
                {
                    skipPreflight: true,
                    preflightCommitment: "single",
                }
            )
        );
    }

    return sendTransactions;
}

async function burnLpMint(lpMint: PublicKey, dev: Keypair): Promise<Promise<void>> {
    const lpMintAssociatedTokenAccount = getAssociatedTokenAddressSync(
        lpMint,
        dev.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const mintTokenAccountBalance = await connection.getTokenAccountBalance(
        lpMintAssociatedTokenAccount,
        "processed"
    );
    const lpMintBalance = new Decimal(mintTokenAccountBalance.value.amount);
    if (lpMintBalance.lte(0)) {
        logger.warn(
            "LP mint %s for %s already burned",
            lpMint.toBase58(),
            dev.publicKey.toBase58()
        );
        return;
    }

    const instructions = [
        createBurnInstruction(
            lpMintAssociatedTokenAccount,
            lpMint,
            dev.publicKey,
            lpMintBalance.toNumber(),
            [],
            TOKEN_PROGRAM_ID
        ),
    ];

    return sendAndConfirmVersionedTransaction(
        instructions,
        [dev],
        `to burn LP mint ${lpMint.toBase58()} for ${dev.publicKey.toBase58()}`,
        prioritizationFees.medianFee,
        {
            skipPreflight: true,
            preflightCommitment: "processed",
        }
    );
}
