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
        if (envVars.NODE_ENV === "production" && !envVars.COLLECTOR_ADDRESS) {
            logger.warn("Collector address must be set for production environment");
            process.exit(0);
        }

        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);
        const sniperDistributor = await importKeypairFromFile(KeypairKind.SniperDistributor);
        const traderDistributor = await importKeypairFromFile(KeypairKind.TraderDistributor);
        const whaleDistributor = await importKeypairFromFile(KeypairKind.WhaleDistributor);
        const snipers = importSwapperKeypairs(KeypairKind.Sniper);
        const traders = importSwapperKeypairs(KeypairKind.Trader);
        const whales = importSwapperKeypairs(KeypairKind.Whale);

        const mint = importMintKeypair();
        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);

        const sendCloseTokenAccountsTransactions = await closeTokenAccounts(
            dev,
            [...snipers, ...whales, ...traders],
            mint,
            raydiumLpMint ? new PublicKey(raydiumLpMint) : undefined
        );
        await Promise.all(sendCloseTokenAccountsTransactions);

        const sendCollectSniperFundsTransactions = await collectFunds(
            snipers,
            sniperDistributor.publicKey,
            KeypairKind.Sniper
        );
        const sendCollectTraderFundsTransactions = await collectFunds(
            traders,
            traderDistributor.publicKey,
            KeypairKind.Trader
        );
        const sendCollectWhaleFundsTransactions = await collectFunds(
            whales,
            whaleDistributor.publicKey,
            KeypairKind.Whale
        );
        await Promise.all([
            ...sendCollectSniperFundsTransactions,
            ...sendCollectTraderFundsTransactions,
            ...sendCollectWhaleFundsTransactions,
        ]);

        logger.warn(
            "Waiting collect funds from main accounts: %s sec",
            formatMilliseconds(MAIN_FUNDS_COLLECTION_INTERVAL_MS)
        );
        await new Promise((resolve) => setTimeout(resolve, MAIN_FUNDS_COLLECTION_INTERVAL_MS));

        const sendCollectMainFundsTransactions =
            envVars.NODE_ENV === "production"
                ? await collectFunds(
                      [dev, sniperDistributor, traderDistributor, whaleDistributor],
                      new PublicKey(envVars.COLLECTOR_ADDRESS),
                      KeypairKind.Main
                  )
                : await collectFunds(
                      [sniperDistributor, traderDistributor, whaleDistributor],
                      dev.publicKey,
                      KeypairKind.Dev
                  );
        await Promise.all(sendCollectMainFundsTransactions);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function closeTokenAccounts(
    dev: Keypair,
    accounts: Keypair[],
    mint?: Keypair,
    lpMint?: PublicKey
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();

    for (const [i, account] of [dev, ...accounts].entries()) {
        const instructions: TransactionInstruction[] = [];
        const computeBudgetInstructions: TransactionInstruction[] = [];
        const isDev = i === 0;

        if (mint && !isDev) {
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

        if (lpMint && isDev) {
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
    recipient: PublicKey,
    keypairKind: KeypairKind
): Promise<Promise<TransactionSignature | undefined>[]> {
    const sendTransactions: Promise<TransactionSignature | undefined>[] = [];
    const computeBudgetInstructions: TransactionInstruction[] = [];

    let connection = connectionPool.current();
    let heliusClient = heliusClientPool.current();
    let fee: number | undefined;

    for (const account of accounts) {
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

        const residualLamports = solBalance.sub(fee);
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: account.publicKey,
                toPubkey: recipient,
                lamports: residualLamports.toNumber(),
            }),
        ];

        sendTransactions.push(
            sendAndConfirmVersionedTransaction(
                connection,
                [...computeBudgetInstructions, ...instructions],
                [account],
                `to transfer ${formatDecimal(residualLamports.div(LAMPORTS_PER_SOL))} SOL from ${keypairKind} (${formatPublicKey(account.publicKey)}) to account (${formatPublicKey(recipient)})`
            )
        );

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    return sendTransactions;
}
