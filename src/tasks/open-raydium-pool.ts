import {
    ApiV3Token,
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
import { importDevKeypair, importHolderKeypairs, importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { getWrapSolInsturctions, sendAndConfirmLegacyTransaction } from "../helpers/network";
import { checkIfStorageExists, checkIfSupportedByRaydium } from "../helpers/validation";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { CpmmPoolInfo, loadRaydiumPoolInfo, loadRaydium } from "../modules/raydium";

type Token = Pick<ApiV3Token, "address" | "programId" | "symbol" | "name" | "decimals">;

const SLIPPAGE = 0.15;

(async () => {
    try {
        checkIfSupportedByRaydium(envVars.CLUSTER);

        await checkIfStorageExists();

        const dev = await importDevKeypair(envVars.DEV_KEYPAIR_PATH);
        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const holders = importHolderKeypairs();
        const amounts = envVars.HOLDER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(percent)
        );
        const eligibleHolders = await findEligibleHolders(holders, mint);

        const [poolId, lpMint] = await createPool(dev, mint);
        const poolInfo = await loadRaydiumPoolInfo(poolId, mint);

        await swapSolToToken(poolInfo, amounts, eligibleHolders);

        await burnLpMint(lpMint, dev);
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

async function createPool(dev: Keypair, mint: Keypair): Promise<[PublicKey, PublicKey]> {
    const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.debug("Raydium pool id loaded from storage", raydiumPoolId);

        const raydimLpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydimLpMint) {
            throw new Error("LP mint not loaded from storage");
        }
        logger.debug("LP mint %s loaded from storage", raydimLpMint);

        return [new PublicKey(raydiumPoolId), new PublicKey(raydimLpMint)];
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

    const mintAAmount = new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL).mul(LAMPORTS_PER_SOL);
    const mintBAmount = new Decimal(envVars.TOKEN_SUPPLY)
        .mul(10 ** envVars.TOKEN_DECIMALS)
        .mul(envVars.INITIAL_POOL_SIZE_PERCENT);

    const wrapSolInstructions = await getWrapSolInsturctions(
        new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL),
        dev
    );

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
        mintAAmount: new BN(mintAAmount.toFixed(0)),
        mintBAmount: new BN(mintBAmount.toFixed(0)),
        startTime: new BN(0),
        feeConfig,
        associatedOnly: true,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    await sendAndConfirmLegacyTransaction(
        [...wrapSolInstructions, ...createPoolInstructions],
        [dev],
        `to create pool ${poolId.toBase58()}`,
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

    return [poolId, lpMint];
}

async function burnLpMint(lpMint: PublicKey, dev: Keypair): Promise<void> {
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

    await sendAndConfirmLegacyTransaction(
        instructions,
        [dev],
        `to burn LP mint ${lpMint.toBase58()} for ${dev.publicKey.toBase58()}`,
        {
            skipPreflight: true,
            preflightCommitment: "processed",
        }
    );
}

async function swapSolToToken(
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    amounts: Decimal[],
    holders: (Keypair | null)[]
): Promise<void> {
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address;
    const transactions: Promise<void>[] = [];

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
        transactions.push(
            sendAndConfirmLegacyTransaction(
                instructions,
                [holder],
                `to swap ${formatDecimal(sourceAmount)} WSOL to ~${formatDecimal(destinationAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} for ${holder.publicKey.toBase58()}`,
                {
                    skipPreflight: true,
                    preflightCommitment: "single",
                }
            )
        );
    }

    await Promise.all(transactions);
}
