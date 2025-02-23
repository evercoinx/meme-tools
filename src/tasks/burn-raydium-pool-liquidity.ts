import "../init";
import { createBurnInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
} from "../modules";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
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

    const [lpMintTokenAccount, lpMintBalance] = await getTokenAccountInfo(
        connectionPool,
        dev,
        lpMint,
        TOKEN_PROGRAM_ID
    );
    if (!lpMintBalance) {
        logger.warn(
            "Dev (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
        );
        return;
    }
    if (lpMintBalance.lte(0)) {
        logger.warn(
            "Dev (%s) has insufficient balance on ATA (%s): 0 LPMint",
            formatPublicKey(dev.publicKey),
            formatPublicKey(lpMintTokenAccount)
        );
        return;
    }

    const instructions = [
        createBurnInstruction(
            lpMintTokenAccount,
            lpMint,
            dev.publicKey,
            lpMintBalance.toNumber(),
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
