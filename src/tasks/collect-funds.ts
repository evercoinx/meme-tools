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
import { importLocalKeypair, importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    MIN_REMAINING_BALANCE_LAMPORTS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_SNIPER_SECRET_KEYS,
    STORAGE_TRADER_SECRET_KEYS,
    SwapperType,
} from "../modules";

(async () => {
    try {
        await checkIfStorageExists();

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const mint = importMintKeypair();
        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper,
            STORAGE_SNIPER_SECRET_KEYS
        );

        const traders = importSwapperKeypairs(
            envVars.TRADER_COUNT,
            SwapperType.Trader,
            STORAGE_TRADER_SECRET_KEYS
        );

        const sendCloseTokenAccountsTransactions = await closeTokenAccounts(
            dev,
            snipers,
            traders,
            mint,
            raydiumLpMint ? new PublicKey(raydiumLpMint) : undefined
        );
        await Promise.all(sendCloseTokenAccountsTransactions);

        const sendCollectFundsTransactions = await collectFunds(snipers, traders, distributor);
        await Promise.all(sendCollectFundsTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function closeTokenAccounts(
    dev: Keypair,
    snipers: Keypair[],
    traders: Keypair[],
    mint?: Keypair,
    lpMint?: PublicKey
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];
    for (const [i, account] of [dev, ...snipers, ...traders].entries()) {
        const isDev = i === 0;
        const instructions: TransactionInstruction[] = [];

        const connection = connectionPool.next();
        const heliusCleint = heliusClientPool.next();

        if (mint) {
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
                    isDev ? "dev" : "account",
                    formatPublicKey(account.publicKey)
                );
            }
        }

        if (isDev) {
            if (lpMint) {
                const lpMintTokenAccount = getAssociatedTokenAddressSync(
                    lpMint,
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
                    "WSOL ATA (%s) not exists for account (%s)",
                    formatPublicKey(wsolTokenAccount),
                    formatPublicKey(account.publicKey)
                );
            }
        }

        if (instructions.length > 0) {
            sendTransactions.push(
                sendAndConfirmVersionedTransaction(
                    connection,
                    heliusCleint,
                    instructions,
                    [account],
                    `to close ATAs for account (${formatPublicKey(account.publicKey)})`,
                    "Min"
                )
            );
        }
    }

    return sendTransactions;
}

async function collectFunds(
    snipers: Keypair[],
    traders: Keypair[],
    distributor: Keypair
): Promise<Promise<void>[]> {
    const sendTransactions: Promise<void>[] = [];

    for (const [i, account] of [...snipers, ...traders].entries()) {
        const connection = connectionPool.next();
        const heliusCleint = heliusClientPool.next();

        const solBalance = await connection.getBalance(account.publicKey, "confirmed");
        if (solBalance <= MIN_REMAINING_BALANCE_LAMPORTS) {
            logger.warn(
                "Account #%d (%s) has insufficient balance: %s SOL",
                i,
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance)
            );
            continue;
        }

        const lamports = solBalance - MIN_REMAINING_BALANCE_LAMPORTS;
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: distributor.publicKey,
                lamports,
            }),
        ];

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                heliusCleint,
                instructions,
                [account],
                `to transfer ${formatDecimal(lamports / LAMPORTS_PER_SOL)} SOL from account (${formatPublicKey(account.publicKey)}) to distributor (${formatPublicKey(distributor.publicKey)})`,
                "Low"
            )
        );
    }

    return sendTransactions;
}
