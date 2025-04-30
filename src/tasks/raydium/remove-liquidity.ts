import { Percent, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importKeypairFromFile, KeypairKind } from "../../helpers/account";
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
    ZERO_BN,
    ZERO_DECIMAL,
} from "../../modules";
import { createRaydium, loadRaydiumCpmmPool, RaydiumCpmmPool } from "../../modules/raydium";
import { STORAGE_RAYDIUM_LP_MINT, STORAGE_RAYDIUM_POOL_ID } from "../../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const poolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!poolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!lpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const raydium = await createRaydium(connectionPool.get(), dev);
        const cpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(poolId));

        const sendRemovePoolLiquidityTransaction = await removePoolLiquidity(
            raydium,
            cpmmPool,
            dev,
            new PublicKey(lpMint)
        );

        await Promise.all([sendRemovePoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function removePoolLiquidity(
    raydium: Raydium,
    { poolInfo, poolKeys }: RaydiumCpmmPool,
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
        return Promise.resolve(undefined);
    }
    if (lpMintTokenBalance.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Dev (%s) has zero balance on LP-%s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(lpMintTokenAccount)
        );
        return Promise.resolve(undefined);
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
        PriorityLevel.HIGH,
        instructions,
        [dev]
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [dev],
        `to remove liquidity from pool id (${formatPublicKey(poolInfo.id)})`
    );
}
