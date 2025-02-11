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
import { importLocalKeypair, importMintKeypair, importSniperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import {
    connection,
    envVars,
    logger,
    MIN_REMAINING_BALANCE_LAMPORTS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { CpmmPoolInfo, loadRaydium, loadRaydiumPoolInfo } from "../modules/raydium";

const SLIPPAGE = 0.3;
const ZERO_BN = new BN(0);

(async () => {
    try {
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

        const snipers = importSniperKeypairs(envVars.SNIPER_SHARE_POOL_PERCENTS.length);

        const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(new PublicKey(raydiumPoolId), mint);
        const unitsToSwap = await getUnitsToSwap(snipers, mint);
        const sendSwapTokenToSolTransactions = await swapTokenToSol(poolInfo, unitsToSwap, snipers);
        await Promise.all(sendSwapTokenToSolTransactions);

        const sendCloseTokenAccountsTransactions = await closeTokenAccounts(
            dev,
            snipers,
            mint,
            new PublicKey(raydiumLpMint)
        );
        await Promise.all(sendCloseTokenAccountsTransactions);

        const sendCollectSolTransactions = await collectSol(snipers, distributor);
        await Promise.all(sendCollectSolTransactions);
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

async function closeTokenAccounts(
    dev: Keypair,
    snipers: Keypair[],
    mint: Keypair,
    lpMintPublicKey: PublicKey
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];
    for (const [i, account] of [dev, ...snipers].entries()) {
        const isDev = i === 0;
        const instructions: TransactionInstruction[] = [];

        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            account.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const mintAccountInfo = await connection.getAccountInfo(mintTokenAccount, "confirmed");
        if (mintAccountInfo) {
            instructions.push(
                createCloseAccountInstruction(
                    mintTokenAccount,
                    account.publicKey,
                    account.publicKey,
                    [],
                    TOKEN_2022_PROGRAM_ID
                )
            );
        } else {
            logger.warn(
                "%s ATA (%s) not exists for %s (%s)",
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount),
                isDev ? "dev" : `sniper #${i - 1}`,
                formatPublicKey(account.publicKey)
            );
        }

        if (isDev) {
            const lpMintTokenAccount = getAssociatedTokenAddressSync(
                lpMintPublicKey,
                dev.publicKey,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            const lpMintAccountInfo = await connection.getAccountInfo(
                lpMintTokenAccount,
                "confirmed"
            );
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
        } else {
            const wsolTokenAccount = getAssociatedTokenAddressSync(
                NATIVE_MINT,
                account.publicKey,
                false,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
            if (wsolAccountInfo) {
                instructions.push(
                    createCloseAccountInstruction(
                        wsolTokenAccount,
                        account.publicKey,
                        account.publicKey,
                        [],
                        TOKEN_PROGRAM_ID
                    )
                );
            } else {
                logger.warn(
                    "WSOL ATA (%s) not exists for sniper #%d (%s)",
                    formatPublicKey(wsolTokenAccount),
                    i - 1,
                    formatPublicKey(account.publicKey)
                );
            }
        }

        if (instructions.length > 0) {
            sendTransactions.push(
                sendAndConfirmVersionedTransaction(
                    instructions,
                    [account],
                    `to close ATAs for account #${i} (${formatPublicKey(account.publicKey)})`,
                    "Min"
                )
            );
        }
    }

    return sendTransactions;
}

async function collectSol(snipers: Keypair[], distributor: Keypair): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const solBalance = await connection.getBalance(sniper.publicKey, "confirmed");
        if (solBalance <= MIN_REMAINING_BALANCE_LAMPORTS) {
            logger.warn(
                "Sniper #%d (%s) has insufficient balance: %s SOL",
                i,
                formatPublicKey(sniper.publicKey),
                formatDecimal(solBalance)
            );
            continue;
        }

        const lamports = solBalance - MIN_REMAINING_BALANCE_LAMPORTS;
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: sniper.publicKey,
                toPubkey: distributor.publicKey,
                lamports,
            }),
        ];

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                instructions,
                [sniper],
                `to transfer ${formatDecimal(lamports / LAMPORTS_PER_SOL)} SOL from sniper #${i} (${formatPublicKey(sniper.publicKey)}) to distributor (${formatPublicKey(distributor.publicKey)})`,
                "Low"
            )
        );
    }

    return sendTransactions;
}
