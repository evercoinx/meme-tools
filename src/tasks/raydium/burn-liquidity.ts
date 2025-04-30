import { createBurnInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import { PriorityLevel } from "helius-sdk";
import {
    getTokenAccountInfo,
    importKeypairFromFile,
    importMintKeypair,
    KeypairKind,
} from "../../helpers/account";
import { checkFileExists } from "../../helpers/filesystem";
import { formatError, formatPublicKey } from "../../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../../helpers/network";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    ZERO_DECIMAL,
} from "../../modules";
import { STORAGE_RAYDIUM_LP_MINT } from "../../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!lpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const sendBurnPoolLiquidityTransaction = await burnPoolLiquidity(
            dev,
            new PublicKey(lpMint)
        );

        await Promise.all([sendBurnPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function burnPoolLiquidity(
    dev: Keypair,
    lpMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.get();
    const heliusClient = heliusClientPool.get();

    const [lpMintTokenAccount, lpMintTokenBalance, lpMintTokenInitialized] =
        await getTokenAccountInfo(connectionPool, dev, lpMint, TOKEN_PROGRAM_ID);

    if (!lpMintTokenInitialized) {
        logger.warn(
            "Dev (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
        );
        return;
    }
    if (lpMintTokenBalance.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Dev (%s) has zero balance on %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
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
