import {
    DEV_LOCK_CPMM_AUTH,
    DEV_LOCK_CPMM_PROGRAM,
    LOCK_CPMM_AUTH,
    LOCK_CPMM_PROGRAM,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getTokenAccountInfo, importKeypairFromFile, KeypairKind } from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import { formatDecimal, formatError, formatPublicKey, formatSignature } from "../helpers/format";
import { connectionPool, envVars, explorer, logger, storage, ZERO_DECIMAL } from "../modules";
import { suppressLogs } from "../modules/logger";
import { createRaydium, loadRaydiumCpmmPool, RAYDIUM_LP_MINT_DECIMALS } from "../modules/raydium";
import {
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_NFT_MINT,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

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
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function lockRaydiumPoolLiquidity(
    raydiumPoolId: PublicKey,
    dev: Keypair,
    lpMint: PublicKey
): Promise<void> {
    const connection = connectionPool.current();

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
    if (lpMintTokenBalance.lte(ZERO_DECIMAL)) {
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
        execute,
        extInfo: { nftMint },
    } = await raydium.cpmm.lockLp<TxVersion.LEGACY>({
        poolInfo,
        poolKeys,
        lpAmount: new BN(lpMintTokenBalance.toFixed(0)),
        withMetadata: true,
        ...(raydium.cluster === "devnet"
            ? {
                  programId: DEV_LOCK_CPMM_PROGRAM,
                  authProgram: DEV_LOCK_CPMM_AUTH,
              }
            : {
                  programId: LOCK_CPMM_PROGRAM,
                  authProgram: LOCK_CPMM_AUTH,
              }),
    });

    const { txId: signature } = await suppressLogs(execute.bind(null, { sendAndConfirm: true }));

    logger.info(
        "Transaction (%s) sent to lock liquidity in pool id (%s)",
        formatSignature(signature),
        formatPublicKey(raydiumPoolId)
    );
    logger.info(
        "Transaction (%s) confirmed: %s",
        formatSignature(signature),
        explorer.generateTransactionUri(signature)
    );

    storage.set(STORAGE_RAYDIUM_NFT_MINT, nftMint);
    storage.save();
    logger.debug("Raydium NFT mint (%s) saved to storage", formatPublicKey(nftMint));

    // TODO Use network helpers below when Raydium SDK makes it available
    // const instructions = (transaction as unknown as Transaction).instructions;

    // const computeBudgetInstructions = await getComputeBudgetInstructions(
    //     connection,
    //     envVars.RPC_CLUSTER,
    //     heliusClient,
    //     PriorityLevel.DEFAULT,
    //     instructions,
    //     [dev]
    // );

    // return sendAndConfirmVersionedTransaction(
    //     connection,
    //     [...computeBudgetInstructions, ...instructions],
    //     [dev],
    //     `to lock liquidity in pool id (${formatPublicKey(raydiumPoolId)})`,
    // );
}
