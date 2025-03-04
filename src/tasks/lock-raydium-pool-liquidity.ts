import { DEV_LOCK_CPMM_AUTH, DEV_LOCK_CPMM_PROGRAM, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importKeypairFromFile, KeypairKind } from "../helpers/account";
import { fileExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import { connectionPool, envVars, heliusClientPool, logger, storage } from "../modules";
import { createRaydium, loadRaydiumCpmmPool, RAYDIUM_LP_MINT_DECIMALS } from "../modules/raydium";
import { STORAGE_RAYDIUM_LP_MINT, STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await fileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const sendLockRaydiumPoolLiquidityTransaction = await lockRaydiumPoolLiquidity(
            new PublicKey(raydiumPoolId),
            dev,
            new PublicKey(raydiumLpMint)
        );

        await Promise.all([sendLockRaydiumPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function lockRaydiumPoolLiquidity(
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

    const clusterLpLockData =
        raydium.cluster === "devnet"
            ? {
                  poolKeys,
                  programId: DEV_LOCK_CPMM_PROGRAM,
                  authProgram: DEV_LOCK_CPMM_AUTH,
              }
            : {};

    const { transaction } = await raydium.cpmm.lockLp<TxVersion.LEGACY>({
        ...{
            poolInfo,
            lpAmount: new BN(lpMintTokenBalance.toFixed(0)),
            withMetadata: true,
        },
        ...clusterLpLockData,
    });
    const instructions = (transaction as unknown as Transaction).instructions;

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
        `to lock liquidity in pool id (${formatPublicKey(raydiumPoolId)})`
    );
}
