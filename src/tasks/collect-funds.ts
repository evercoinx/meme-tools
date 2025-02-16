import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createCloseAccountInstruction,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { importLocalKeypair, importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { capitalize, formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    MIN_REMAINING_BALANCE_LAMPORTS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    SwapperType,
    ZERO_DECIMAL,
} from "../modules";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const mint = importMintKeypair();
        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const sendCloseTokenAccountsTransactions = await closeTokenAccounts(
            dev,
            snipers,
            traders,
            mint,
            raydiumLpMint ? new PublicKey(raydiumLpMint) : undefined
        );
        await Promise.all(sendCloseTokenAccountsTransactions);

        const sendSniperCollectFundsTransactions = await collectFunds(
            snipers,
            distributor,
            SwapperType.Sniper
        );
        const sendTraderCollectFundsTransactions = await collectFunds(
            traders,
            distributor,
            SwapperType.Trader
        );
        await Promise.all([
            ...sendSniperCollectFundsTransactions,
            ...sendTraderCollectFundsTransactions,
        ]);
        process.exit(0);
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
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    for (const [i, account] of [dev, ...snipers, ...traders].entries()) {
        const isDev = i === 0;

        const connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        const instructions: TransactionInstruction[] = [];
        const computeBudgetInstructions: TransactionInstruction[] = [];

        if (mint) {
            const tokenAccount = getAssociatedTokenAddressSync(
                mint.publicKey,
                account.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            let tokenBalance: Decimal | null = null;
            try {
                const tokenAccountBalance = await connection.getTokenAccountBalance(
                    tokenAccount,
                    "confirmed"
                );
                tokenBalance = new Decimal(tokenAccountBalance.value.amount.toString());
            } catch {
                // Ignore TokenAccountNotFoundError error
            }

            if (tokenBalance === null) {
                logger.warn(
                    "%s ATA (%s) not exists for %s (%s)",
                    envVars.TOKEN_SYMBOL,
                    formatPublicKey(tokenAccount),
                    isDev ? "dev" : "account",
                    formatPublicKey(account.publicKey)
                );
            } else if (tokenBalance.eq(0)) {
                instructions.push(
                    createCloseAccountInstruction(
                        tokenAccount,
                        account.publicKey,
                        account.publicKey,
                        [],
                        TOKEN_2022_PROGRAM_ID
                    )
                );
            } else {
                logger.warn(
                    "%s ATA (%s) has positive balance for %s (%s): %s %s",
                    envVars.TOKEN_SYMBOL,
                    formatPublicKey(tokenAccount),
                    isDev ? "dev" : "account",
                    formatPublicKey(account.publicKey),
                    tokenBalance
                        ? formatDecimal(tokenBalance.div(10 ** envVars.TOKEN_DECIMALS))
                        : "?",
                    envVars.TOKEN_SYMBOL
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
            // const wsolTokenAccount = getAssociatedTokenAddressSync(
            //     NATIVE_MINT,
            //     account.publicKey,
            //     false,
            //     TOKEN_PROGRAM_ID,
            //     ASSOCIATED_TOKEN_PROGRAM_ID
            // );
            // const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
            // if (wsolAccountInfo) {
            //     instructions.push(
            //         createCloseAccountInstruction(
            //             wsolTokenAccount,
            //             account.publicKey,
            //             account.publicKey,
            //             [],
            //             TOKEN_PROGRAM_ID
            //         )
            //     );
            // } else {
            //     logger.warn(
            //         "WSOL ATA (%s) not exists for account (%s)",
            //         formatPublicKey(wsolTokenAccount),
            //         formatPublicKey(account.publicKey)
            //     );
            // }
        }

        if (instructions.length > 0) {
            if (computeBudgetInstructions.length === 0) {
                computeBudgetInstructions.push(
                    ...(await getComputeBudgetInstructions(
                        connection,
                        heliusClient,
                        "Low",
                        instructions,
                        dev
                    ))
                );
            }

            sendTransactions.push(
                sendAndConfirmVersionedTransaction(
                    connection,
                    [...computeBudgetInstructions, ...instructions],
                    [account],
                    `to close ATAs for account (${formatPublicKey(account.publicKey)})`
                )
            );
        }
    }

    return sendTransactions;
}

async function collectFunds(
    accounts: Keypair[],
    distributor: Keypair,
    swapperType: SwapperType
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    const computeBudgetInstructions: TransactionInstruction[] = [];

    for (const account of accounts) {
        let connection = connectionPool.next();
        const heliusClient = heliusClientPool.next();

        let solBalance = ZERO_DECIMAL;
        try {
            solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));
        } catch {
            connection = connectionPool.next();
            solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));
        }
        if (solBalance.lte(MIN_REMAINING_BALANCE_LAMPORTS)) {
            logger.warn(
                "%s (%s) has insufficient balance: %s SOL",
                capitalize(swapperType),
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance)
            );
            continue;
        }

        const residualLamports = solBalance.sub(MIN_REMAINING_BALANCE_LAMPORTS);
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: distributor.publicKey,
                lamports: residualLamports.trunc().toNumber(),
            }),
        ];

        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    heliusClient,
                    "Low",
                    instructions,
                    account
                ))
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [account],
                `to transfer ${formatDecimal(residualLamports.div(LAMPORTS_PER_SOL))} SOL from ${swapperType} (${formatPublicKey(account.publicKey)}) to distributor (${formatPublicKey(distributor.publicKey)})`
            )
        );
    }

    return sendTransactions;
}
