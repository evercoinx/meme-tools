import { CurveCalculator, TxVersion } from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createCloseAccountInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importHolderKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { formatDecimal } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
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

const SLIPPAGE = 0.3;
const ZERO_BN = new BN(0);

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

        const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded");
        }

        const raydimLpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydimLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        await prioritizationFees.fetchFees();

        const poolInfo = await loadRaydiumPoolInfo(new PublicKey(raydiumPoolId), mint);
        const sendSwapTokenToSolTransactions = await swapTokenToSol(poolInfo, holders, mint);
        const sendCloseDevTokenAccountsTransaction = await closeDevTokenAccounts(
            dev,
            mint,
            new PublicKey(raydimLpMint)
        );

        await Promise.all([
            ...sendSwapTokenToSolTransactions,
            sendCloseDevTokenAccountsTransaction,
        ]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function swapTokenToSol(
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    holders: Keypair[],
    mint: Keypair
): Promise<Promise<void>[]> {
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintB.address;
    const sendTransactions: Promise<void>[] = [];

    for (const holder of holders) {
        const mintAssociatedTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            holder.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        let mintBalance = ZERO_BN;
        try {
            const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                mintAssociatedTokenAccount,
                "confirmed"
            );
            mintBalance = new BN(mintTokenAccountBalance.value.amount.toString());
        } catch {
            logger.warn(
                "Mint associated token account not exists for holder %s",
                holder.publicKey.toBase58()
            );
            continue;
        }
        if (mintBalance.eq(ZERO_BN)) {
            logger.warn("Holder %s has 0 mint balance", holder.publicKey.toBase58());
            continue;
        }

        const swapResult = CurveCalculator.swap(
            mintBalance,
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
            inputAmount: mintBalance,
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

        instructions.push(
            createCloseAccountInstruction(
                mintAssociatedTokenAccount,
                holder.publicKey,
                holder.publicKey,
                [],
                TOKEN_2022_PROGRAM_ID
            )
        );

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [holder],
                `to swap ~${formatDecimal(sourceAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} to ${formatDecimal(destinationAmount)} WSOL for ${holder.publicKey.toBase58()}`,
                prioritizationFees.medianFee
            )
        );
    }

    return sendTransactions;
}

async function closeDevTokenAccounts(
    dev: Keypair,
    mint: Keypair,
    lpMintPublicKey: PublicKey
): Promise<Promise<void>> {
    const instructions: TransactionInstruction[] = [];

    const mintAssociatedTokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        dev.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const mintAccountInfo = await connection.getAccountInfo(
        mintAssociatedTokenAccount,
        "confirmed"
    );
    if (mintAccountInfo) {
        instructions.push(
            createCloseAccountInstruction(
                mintAssociatedTokenAccount,
                dev.publicKey,
                dev.publicKey,
                [],
                TOKEN_2022_PROGRAM_ID
            )
        );
    } else {
        logger.warn(
            "Mint associated token account not exists for dev %s",
            dev.publicKey.toBase58()
        );
    }

    const lpMintAssociatedTokenAccount = getAssociatedTokenAddressSync(
        lpMintPublicKey,
        dev.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const lpMintAccountInfo = await connection.getAccountInfo(
        lpMintAssociatedTokenAccount,
        "confirmed"
    );
    if (lpMintAccountInfo) {
        instructions.push(
            createCloseAccountInstruction(
                lpMintAssociatedTokenAccount,
                dev.publicKey,
                dev.publicKey,
                [],
                TOKEN_PROGRAM_ID
            )
        );
    } else {
        logger.warn(
            "LP mint associated token account not exists for dev %s",
            dev.publicKey.toBase58()
        );
    }

    return instructions.length === 0
        ? Promise.resolve()
        : sendAndConfirmVersionedTransaction(
              instructions,
              [dev],
              `to close associated token accounts for dev ${dev.publicKey.toBase58()}`,
              prioritizationFees.averageFeeWithZeros
          );
}
