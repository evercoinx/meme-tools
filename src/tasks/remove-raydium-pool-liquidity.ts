import { Percent, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import { BN } from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importKeypairFromFile } from "../helpers/account";
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
    STORAGE_RAYDIUM_POOL_ID,
    ZERO_BN,
} from "../modules";
import { createRaydium, loadRaydiumCpmmPool } from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const dev = await importKeypairFromFile(envVars.KEYPAIR_FILE_PATH_DEV, "dev");

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const sendRemoveRaydiumPoolLiquidityTransaction = await removeRaydiumPoolLiquidity(
            new PublicKey(raydiumPoolId),
            dev,
            new PublicKey(raydiumLpMint)
        );

        await Promise.all([sendRemoveRaydiumPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function removeRaydiumPoolLiquidity(
    raydiumPoolId: PublicKey,
    dev: Keypair,
    lpMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const raydium = await createRaydium(connection, dev);
    const { poolInfo, poolKeys } = await loadRaydiumCpmmPool(raydium, raydiumPoolId);

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

    const {
        transaction: { instructions },
    } = await raydium.cpmm.withdrawLiquidity<TxVersion.LEGACY>({
        poolInfo,
        poolKeys,
        lpAmount: new BN(lpMintTokenBalance.toFixed(0)),
        slippage: new Percent(ZERO_BN),
    });

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
        `to remove liquidity to pool id (${formatPublicKey(raydiumPoolId)})`
    );
}
