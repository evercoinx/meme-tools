import { CurveCalculator, TxVersion } from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createCloseAccountInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importHolderKeypairs, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import { checkIfStorageExists, checkIfSupportedByRaydium } from "../helpers/validation";
import {
    connection,
    envVars,
    logger,
    MIN_REMAINING_BALANCE_LAMPORTS,
    prioritizationFees,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { PrioritizationFees } from "../modules/prioritization-fees";
import { CpmmPoolInfo, loadRaydium, loadRaydiumPoolInfo } from "../modules/raydium";

const SLIPPAGE = 0.3;
const ZERO_BN = new BN(0);

(async () => {
    try {
        checkIfSupportedByRaydium(envVars.CLUSTER);
        await checkIfStorageExists();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const holders = importHolderKeypairs(envVars.HOLDER_SHARE_POOL_PERCENTS.length);

        const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(new PublicKey(raydiumPoolId), mint);
        const unitsToSwap = await getUnitsToSwap(holders, mint);
        await prioritizationFees.fetchFees();
        const sendSwapTokenToSolTransactions = await swapTokenToSol(poolInfo, unitsToSwap, holders);
        await Promise.all(sendSwapTokenToSolTransactions);

        const sendCloseDevTokenAccountsTransaction = await closeDevTokenAccounts(
            dev,
            mint,
            new PublicKey(raydiumLpMint)
        );
        const sendCloseHolderTokenAccountsTransactions = await closeHolderTokenAccounts(
            holders,
            mint
        );
        await Promise.all([
            sendCloseDevTokenAccountsTransaction,
            ...sendCloseHolderTokenAccountsTransactions,
        ]);

        const sendCollectSolTransactions = await collectSol(holders, distributor);
        await Promise.all(sendCollectSolTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function swapTokenToSol(
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    unitsToSwap: (BN | null)[],
    holders: Keypair[]
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintB.address;

    for (const [i, holder] of holders.entries()) {
        if (unitsToSwap[i] === null) {
            continue;
        }

        const swapResult = CurveCalculator.swap(
            unitsToSwap[i],
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
            inputAmount: unitsToSwap[i],
            swapResult,
            slippage: SLIPPAGE,
            baseIn,
        });

        const sourceAmount = new Decimal(swapResult.sourceAmountSwapped.toString(10)).div(
            10 ** envVars.TOKEN_DECIMALS
        );
        const destinationAmount = new Decimal(swapResult.destinationAmountSwapped.toString(10)).div(
            LAMPORTS_PER_SOL
        );

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [holder],
                `to swap ${formatDecimal(sourceAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} to ~${formatDecimal(destinationAmount)} WSOL for holder #${i} (${formatPublicKey(holder.publicKey)})`,
                prioritizationFees.medianFee,
                {
                    skipPreflight: true,
                    preflightCommitment: "confirmed",
                }
            )
        );
    }

    return sendTransactions;
}

async function getUnitsToSwap(holders: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSwap: (BN | null)[] = [];

    for (const [i, holder] of holders.entries()) {
        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            holder.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        let mintBalance = ZERO_BN;

        try {
            const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                mintTokenAccount,
                "confirmed"
            );
            mintBalance = new BN(mintTokenAccountBalance.value.amount.toString());
        } catch {
            logger.warn(
                "%s ATA (%s) not exists for holder #%d (%s)",
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount),
                i,
                formatPublicKey(holder.publicKey)
            );
            continue;
        }

        if (mintBalance.gt(ZERO_BN)) {
            unitsToSwap[i] = mintBalance;
        } else {
            unitsToSwap[i] = null;
            logger.warn(
                "Holder #%d (%s) has 0 %s",
                i,
                formatPublicKey(holder.publicKey),
                envVars.TOKEN_SYMBOL
            );
        }
    }

    return unitsToSwap;
}

async function closeDevTokenAccounts(
    dev: Keypair,
    mint: Keypair,
    lpMintPublicKey: PublicKey
): Promise<Promise<void>> {
    const instructions: TransactionInstruction[] = [];

    const mintTokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        dev.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const mintAccountInfo = await connection.getAccountInfo(mintTokenAccount, "confirmed");
    if (mintAccountInfo) {
        instructions.push(
            createCloseAccountInstruction(
                mintTokenAccount,
                dev.publicKey,
                dev.publicKey,
                [],
                TOKEN_2022_PROGRAM_ID
            )
        );
    } else {
        logger.warn(
            "%s ATA (%s) not exists for dev (%s)",
            envVars.TOKEN_SYMBOL,
            formatPublicKey(mint.publicKey),
            formatPublicKey(dev.publicKey)
        );
    }

    const lpMintTokenAccount = getAssociatedTokenAddressSync(
        lpMintPublicKey,
        dev.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const lpMintAccountInfo = await connection.getAccountInfo(lpMintTokenAccount, "confirmed");
    if (lpMintAccountInfo) {
        instructions.push(
            createCloseAccountInstruction(
                lpMintTokenAccount,
                dev.publicKey,
                dev.publicKey,
                [],
                TOKEN_PROGRAM_ID
            )
        );
    } else {
        logger.warn(
            "LP mint ATA (%s) not exists for dev (%s)",
            formatPublicKey(lpMintTokenAccount),
            formatPublicKey(dev.publicKey)
        );
    }

    return instructions.length === 0
        ? Promise.resolve()
        : sendAndConfirmVersionedTransaction(
              instructions,
              [dev],
              `to close ATAs for dev (${formatPublicKey(dev.publicKey)})`,
              PrioritizationFees.NO_FEES
          );
}

async function closeHolderTokenAccounts(
    holders: Keypair[],
    mint: Keypair
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];

    for (const [i, holder] of holders.entries()) {
        const instructions: TransactionInstruction[] = [];

        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            holder.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const mintAccountInfo = await connection.getAccountInfo(mintTokenAccount, "confirmed");
        if (mintAccountInfo) {
            instructions.push(
                createCloseAccountInstruction(
                    mintTokenAccount,
                    holder.publicKey,
                    holder.publicKey,
                    [],
                    TOKEN_2022_PROGRAM_ID
                )
            );
        } else {
            logger.warn(
                "%s ATA (%s) not exists for holder #%d (%s)",
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount),
                i,
                formatPublicKey(holder.publicKey)
            );
        }

        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            holder.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
        if (wsolAccountInfo) {
            instructions.push(
                createCloseAccountInstruction(
                    wsolTokenAccount,
                    holder.publicKey,
                    holder.publicKey,
                    [],
                    TOKEN_PROGRAM_ID
                )
            );
        } else {
            logger.warn(
                "WSOL ATA (%s) not exists for holder #%d (%s)",
                formatPublicKey(wsolTokenAccount),
                i,
                formatPublicKey(holder.publicKey)
            );
        }

        if (instructions.length > 0) {
            sendTransactions.push(
                sendAndConfirmVersionedTransaction(
                    instructions,
                    [holder],
                    `to close ATAs for holder #${i} (${formatPublicKey(holder.publicKey)})`,
                    PrioritizationFees.NO_FEES
                )
            );
        }
    }

    return sendTransactions;
}

async function collectSol(holders: Keypair[], distributor: Keypair): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];

    for (const [i, holder] of holders.entries()) {
        const solBalance = await connection.getBalance(holder.publicKey, "confirmed");
        if (solBalance <= MIN_REMAINING_BALANCE_LAMPORTS) {
            logger.warn(
                "Holder #%d (%s) has insufficient balance: %s SOL",
                i,
                formatPublicKey(holder.publicKey),
                formatDecimal(solBalance)
            );
            continue;
        }

        const lamports = solBalance - MIN_REMAINING_BALANCE_LAMPORTS;
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: holder.publicKey,
                toPubkey: distributor.publicKey,
                lamports,
            }),
        ];

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [holder],
                `to transfer ${formatDecimal(lamports / LAMPORTS_PER_SOL)} SOL from holder #${i} (${formatPublicKey(holder.publicKey)}) to distributor (${formatPublicKey(distributor.publicKey)})`,
                PrioritizationFees.NO_FEES
            )
        );
    }

    return sendTransactions;
}
