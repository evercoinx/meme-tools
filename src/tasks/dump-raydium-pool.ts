import { CurveCalculator, TxVersion } from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_SNIPER_SECRET_KEYS,
    SwapperType,
} from "../modules";
import { CpmmPoolInfo, loadRaydium, loadRaydiumPoolInfo } from "../modules/raydium";

const SLIPPAGE = 0.3;
const ZERO_BN = new BN(0);

(async () => {
    try {
        await checkIfStorageExists();

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper,
            STORAGE_SNIPER_SECRET_KEYS
        );

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);
        const unitsToSwap = await getUnitsToSwap(snipers, mint);

        const sendSwapTokenToSolTransactions = await swapTokenToSol(poolInfo, unitsToSwap, snipers);
        await Promise.all(sendSwapTokenToSolTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function swapTokenToSol(
    { poolInfo, poolKeys, baseReserve, quoteReserve, tradeFee }: CpmmPoolInfo,
    unitsToSwap: (BN | null)[],
    snipers: Keypair[]
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];
    const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintB.address;

    for (const [i, sniper] of snipers.entries()) {
        if (unitsToSwap[i] === null) {
            continue;
        }

        const swapResult = CurveCalculator.swap(
            unitsToSwap[i],
            baseIn ? baseReserve : quoteReserve,
            baseIn ? quoteReserve : baseReserve,
            tradeFee
        );

        const raydium = await loadRaydium(connection, sniper);
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
                connection,
                instructions,
                [sniper],
                `to swap ${formatDecimal(sourceAmount, envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL} to ~${formatDecimal(destinationAmount)} WSOL for sniper #${i} (${formatPublicKey(sniper.publicKey)})`,
                "VeryHigh",
                { skipPreflight: true }
            )
        );
    }

    return sendTransactions;
}

async function getUnitsToSwap(snipers: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSwap: (BN | null)[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            sniper.publicKey,
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
            unitsToSwap[i] = null;
            continue;
        }

        unitsToSwap[i] = mintBalance.gt(ZERO_BN) ? mintBalance : null;
    }

    return unitsToSwap;
}
