import {
    createBurnInstruction,
    createCloseAccountInstruction,
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
import { PriorityLevel } from "helius-sdk";
import {
    getSolBalance,
    getTokenAccountInfo,
    importKeypairFromFile,
    importMintKeypair,
    importSwapperKeypairs,
} from "../helpers/account";
import { checkIfStorageFileExists } from "../helpers/filesystem";
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
    MINT_DUST_UNITS,
    storage,
    SwapperType,
    UNITS_PER_MINT,
    ZERO_DECIMAL,
} from "../modules";
import { STORAGE_RAYDIUM_LP_MINT } from "../modules/storage";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const dev = await importKeypairFromFile(envVars.KEYPAIR_FILE_PATH_DEV, "dev");
        const distributor = await importKeypairFromFile(
            envVars.KEYPAIR_FILE_PATH_DISTRIBUTOR,
            "distributor"
        );

        const mint = importMintKeypair();
        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_POOL_SHARE_PERCENTS.length,
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

        const sendCollectSniperFundsTransactions = await collectFunds(
            snipers,
            distributor,
            SwapperType.Sniper
        );
        const sendCollectTraderFundsTransactions = await collectFunds(
            traders,
            distributor,
            SwapperType.Trader
        );
        await Promise.all([
            ...sendCollectSniperFundsTransactions,
            ...sendCollectTraderFundsTransactions,
        ]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
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
    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, account] of [dev, ...snipers, ...traders].entries()) {
        const isDev = i === 0;

        const instructions: TransactionInstruction[] = [];
        const computeBudgetInstructions: TransactionInstruction[] = [];

        if (mint) {
            const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );

            if (!mintTokenBalance) {
                logger.warn(
                    "Account (%s) has uninitialized %s ATA (%s)",
                    formatPublicKey(account.publicKey),
                    envVars.TOKEN_SYMBOL,
                    formatPublicKey(mintTokenAccount)
                );
            } else {
                if (mintTokenBalance.gt(ZERO_DECIMAL) && mintTokenBalance.lte(MINT_DUST_UNITS)) {
                    instructions.push(
                        createBurnInstruction(
                            mintTokenAccount,
                            mint.publicKey,
                            account.publicKey,
                            mintTokenBalance.toNumber(),
                            [],
                            TOKEN_2022_PROGRAM_ID
                        )
                    );
                    logger.warn(
                        "Account (%s) has dust tokens on %s ATA (%s): %s %s",
                        formatPublicKey(account.publicKey),
                        envVars.TOKEN_SYMBOL,
                        formatPublicKey(mintTokenAccount),
                        formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
                        envVars.TOKEN_SYMBOL
                    );
                }

                instructions.push(
                    createCloseAccountInstruction(
                        mintTokenAccount,
                        account.publicKey,
                        account.publicKey,
                        [],
                        TOKEN_2022_PROGRAM_ID
                    )
                );
            }
        }

        if (isDev) {
            if (lpMint) {
                const [lpMintTokenAccount, lpMintTokenBalance] = await getTokenAccountInfo(
                    connectionPool,
                    dev,
                    lpMint,
                    TOKEN_PROGRAM_ID
                );
                if (!lpMintTokenBalance) {
                    logger.warn(
                        "Dev (%s) has uninitialized LP mint ATA (%s)",
                        formatPublicKey(dev.publicKey),
                        formatPublicKey(lpMintTokenAccount)
                    );
                } else if (lpMintTokenBalance.lte(0)) {
                    instructions.push(
                        createCloseAccountInstruction(
                            lpMintTokenAccount,
                            dev.publicKey,
                            dev.publicKey,
                            [],
                            TOKEN_PROGRAM_ID
                        )
                    );
                }
            }
        }

        if (instructions.length > 0) {
            if (computeBudgetInstructions.length === 0) {
                computeBudgetInstructions.push(
                    ...(await getComputeBudgetInstructions(
                        connection,
                        envVars.RPC_CLUSTER,
                        heliusClient,
                        PriorityLevel.LOW,
                        instructions,
                        [account]
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

            connection = connectionPool.next();
            heliusClient = heliusClientPool.next();
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

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const account of accounts) {
        const solBalance = await getSolBalance(connectionPool, account);
        if (solBalance.lte(MIN_REMAINING_BALANCE_LAMPORTS)) {
            logger.warn(
                "%s (%s) has insufficient balance on wallet: %s SOL",
                capitalize(swapperType),
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
            continue;
        }

        const residualLamports = solBalance.sub(MIN_REMAINING_BALANCE_LAMPORTS);
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: distributor.publicKey,
                lamports: residualLamports.toNumber(),
            }),
        ];

        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    envVars.RPC_CLUSTER,
                    heliusClient,
                    PriorityLevel.LOW,
                    instructions,
                    [account]
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

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    return sendTransactions;
}
