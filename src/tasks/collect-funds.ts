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
    KeypairKind,
} from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import {
    capitalize,
    formatDecimal,
    formatError,
    formatMilliseconds,
    formatPublicKey,
} from "../helpers/format";
import {
    calculateFee,
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    MINT_DUST_UNITS,
    storage,
    UNITS_PER_MINT,
    ZERO_DECIMAL,
} from "../modules";
import { STORAGE_RAYDIUM_LP_MINT } from "../modules/storage";

const MAIN_FUNDS_COLLECTION_INTERVAL_MS = 15_000;

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
        const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);
        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const traders = importSwapperKeypairs(KeypairKind.Trader);
        const whales = importSwapperKeypairs(KeypairKind.Whale);

        const sendCloseSwapperTokenAccountsTransactions: Promise<
            TransactionSignature | undefined
        >[] = [];

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            logger.warn("Raydium LP mint not loaded from storage");
        } else {
            sendCloseSwapperTokenAccountsTransactions.push(
                ...(await closeDevTokenAccount(dev, new PublicKey(raydiumLpMint)))
            );
        }

        const mint = importMintKeypair();
        if (!mint) {
            logger.warn("Mint not loaded from storage");
        } else {
            sendCloseSwapperTokenAccountsTransactions.push(
                ...(await closeSwapperTokenAccounts(snipers, KeypairKind.Sniper, mint))
            );
            sendCloseSwapperTokenAccountsTransactions.push(
                ...(await closeSwapperTokenAccounts(whales, KeypairKind.Whale, mint))
            );
            sendCloseSwapperTokenAccountsTransactions.push(
                ...(await closeSwapperTokenAccounts(traders, KeypairKind.Trader, mint))
            );
        }
        await Promise.all(sendCloseSwapperTokenAccountsTransactions);

        const sendCollectSwapperFundsTransactions: Promise<TransactionSignature | undefined>[] = [];
        sendCollectSwapperFundsTransactions.push(
            ...(await collectFunds(snipers, sniperDistributor.publicKey, KeypairKind.Sniper))
        );
        sendCollectSwapperFundsTransactions.push(
            ...(await collectFunds(whales, whaleDistributor.publicKey, KeypairKind.Whale))
        );
        sendCollectSwapperFundsTransactions.push(
            ...(await collectFunds(traders, traderDistributor.publicKey, KeypairKind.Trader))
        );
        await Promise.all(sendCollectSwapperFundsTransactions);

        logger.warn(
            "Waiting %s sec to collect funds from main accounts",
            formatMilliseconds(MAIN_FUNDS_COLLECTION_INTERVAL_MS)
        );
        await new Promise((resolve) => setTimeout(resolve, MAIN_FUNDS_COLLECTION_INTERVAL_MS));

        const accounts = [sniperDistributor, traderDistributor, whaleDistributor];
        if (envVars.NODE_ENV === "production") {
            accounts.push(dev);
        }

        const sendCollectMainFundsTransactions = await collectFunds(
            accounts,
            new PublicKey(envVars.COLLECTOR_ADDRESS),
            KeypairKind.Main
        );
        await Promise.all(sendCollectMainFundsTransactions);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function closeDevTokenAccount(
    dev: Keypair,
    lpMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>[]> {
    const connection = connectionPool.get();
    const heliusClient = heliusClientPool.get();
    const instructions: TransactionInstruction[] = [];
    const computeBudgetInstructions: TransactionInstruction[] = [];
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];

    const [lpMintTokenAccount, lpMintTokenBalance, lpMintTokenInitialized] =
        await getTokenAccountInfo(connectionPool, dev, lpMint, TOKEN_PROGRAM_ID);

    if (!lpMintTokenInitialized) {
        logger.warn(
            "Dev (%s) has uninitialized LP mint ATA (%s)",
            formatPublicKey(dev.publicKey),
            formatPublicKey(lpMintTokenAccount)
        );
    } else if (lpMintTokenBalance.lte(ZERO_DECIMAL)) {
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

    if (instructions.length > 0) {
        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    envVars.RPC_CLUSTER,
                    heliusClient,
                    PriorityLevel.DEFAULT,
                    instructions,
                    [dev]
                ))
            );
        }

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [dev],
                `to close ATAs for dev (${formatPublicKey(dev.publicKey)})`
            )
        );
    }

    return sendTransactions;
}

async function closeSwapperTokenAccounts(
    accounts: Keypair[],
    keypairKind: KeypairKind,
    mint: Keypair
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];

    for (const account of accounts) {
        const connection = connectionPool.get();
        const heliusClient = heliusClientPool.get();
        const instructions: TransactionInstruction[] = [];
        const computeBudgetInstructions: TransactionInstruction[] = [];

        const [mintTokenAccount, mintTokenBalance, mintTokenInitialized] =
            await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );

        if (!mintTokenInitialized) {
            logger.warn(
                "Account (%s) has uninitialized %s ATA (%s)",
                formatPublicKey(account.publicKey),
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount)
            );
        } else if (mintTokenBalance.lte(ZERO_DECIMAL)) {
            logger.warn(
                "Account (%s) has zero balance on %s ATA (%s)",
                formatPublicKey(account.publicKey),
                envVars.TOKEN_SYMBOL,
                formatPublicKey(mintTokenAccount)
            );
        } else {
            if (mintTokenBalance.lte(MINT_DUST_UNITS)) {
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

        if (instructions.length > 0) {
            if (computeBudgetInstructions.length === 0) {
                computeBudgetInstructions.push(
                    ...(await getComputeBudgetInstructions(
                        connection,
                        envVars.RPC_CLUSTER,
                        heliusClient,
                        PriorityLevel.DEFAULT,
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
                    `to close ATAs for ${keypairKind} (${formatPublicKey(account.publicKey)})`
                )
            );
        }
    }

    return sendTransactions;
}

async function collectFunds(
    accounts: Keypair[],
    recipient: PublicKey,
    keypairKind: KeypairKind
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    const computeBudgetInstructions: TransactionInstruction[] = [];
    let fee: number | undefined;

    for (const account of accounts) {
        const connection = connectionPool.get();
        const heliusClient = heliusClientPool.get();

        const solBalance = await getSolBalance(connectionPool, account);
        if (solBalance.lte(ZERO_DECIMAL)) {
            logger.warn(
                "%s (%s) has zero balance on wallet",
                capitalize(keypairKind),
                formatPublicKey(account.publicKey)
            );
            continue;
        }

        const testInstructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: recipient,
                lamports: 1,
            }),
        ];

        if (computeBudgetInstructions.length === 0) {
            computeBudgetInstructions.push(
                ...(await getComputeBudgetInstructions(
                    connection,
                    envVars.RPC_CLUSTER,
                    heliusClient,
                    PriorityLevel.DEFAULT,
                    testInstructions,
                    [account]
                ))
            );
        }

        if (fee === undefined) {
            fee = await calculateFee(
                connection,
                [...computeBudgetInstructions, ...testInstructions],
                [account]
            );
        }

        const lamportsToCollect = solBalance.sub(fee);
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: recipient,
                lamports: lamportsToCollect.toNumber(),
            }),
        ];

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [account],
                `to transfer ${formatDecimal(lamportsToCollect.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} (${formatPublicKey(account.publicKey)}) to account (${formatPublicKey(recipient)})`
            )
        );
    }

    return sendTransactions;
}
