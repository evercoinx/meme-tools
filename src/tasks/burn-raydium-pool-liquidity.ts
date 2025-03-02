import { createBurnInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importKeypairFromFile, importMintKeypair } from "../helpers/account";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
} from "../modules";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const dev = await importKeypairFromFile(envVars.KEYPAIR_FILE_PATH_DEV, "dev");

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const sendBurnRaydiumPoolLiquidityTransaction = await burnRaydiumPoolLiquidity(
            dev,
            new PublicKey(raydiumLpMint)
        );

        await Promise.all([sendBurnRaydiumPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function burnRaydiumPoolLiquidity(
    dev: Keypair,
    lpMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const [lpMintTokenAccount, lpMintTokenBalance] = await getTokenAccountInfo(
        connectionPool,
        dev,
        lpMint,
        TOKEN_PROGRAM_ID
    );
    if (!lpMintTokenBalance) {
        logger.warn(
            "Dev (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
        );
        return;
    }
    if (lpMintTokenBalance.lte(0)) {
        logger.warn(
            "Dev (%s) has insufficient balance on ATA (%s): %s LP-%s",
            formatPublicKey(dev.publicKey),
            formatPublicKey(lpMintTokenAccount),
            formatDecimal(
                lpMintTokenBalance.div(10 ** RAYDIUM_LP_MINT_DECIMALS),
                RAYDIUM_LP_MINT_DECIMALS
            ),
            envVars.TOKEN_SYMBOL
        );
        return;
    }

    const instructions = [
        createBurnInstruction(
            lpMintTokenAccount,
            lpMint,
            dev.publicKey,
            lpMintTokenBalance.toNumber(),
            [],
            TOKEN_PROGRAM_ID
        ),
    ];

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        envVars.RPC_CLUSTER,
        heliusClient,
        PriorityLevel.DEFAULT,
        instructions,
        [dev]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to burn LP mint (${formatPublicKey(lpMint)}) for dev (${formatPublicKey(dev.publicKey)})`
    );
}
