import { Percent, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
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
    ZERO_BN,
} from "../../modules";
import { createRaydium, loadRaydiumCpmmPool } from "../../modules/raydium";
import { STORAGE_RAYDIUM_POOL_ID } from "../../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const poolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!poolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const sendAddPoolLiquidityTransaction = await addPoolLiquidity(
            new PublicKey(poolId),
            dev,
            mint
        );

        await Promise.all([sendAddPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function addPoolLiquidity(
    poolId: PublicKey,
    dev: Keypair,
    mint: Keypair
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.get();
    const heliusClient = heliusClientPool.get();
    const raydium = await createRaydium(connection, dev);
    const { poolInfo, poolKeys } = await loadRaydiumCpmmPool(raydium, poolId);

    const [mintTokenAccount, mintTokenBalance, mintTokenInitialized] = await getTokenAccountInfo(
        connectionPool,
        dev,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID
    );

    if (!mintTokenInitialized) {
        logger.warn(
            "Dev (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(mintTokenAccount)
        );
        return;
    }
    if (mintTokenBalance.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Dev (%s) has zero balance on %s ATA (%s)",
            formatPublicKey(dev.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(mintTokenAccount)
        );
        return;
    }

    const {
        transaction: { instructions },
    } = await raydium.cpmm.addLiquidity<TxVersion.LEGACY>({
        poolInfo,
        poolKeys,
        inputAmount: new BN(mintTokenBalance.toFixed(0)),
        slippage: new Percent(ZERO_BN),
        baseIn: NATIVE_MINT.toBase58() === poolInfo.mintB.address,
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
        `to add liquidity to pool id (${formatPublicKey(poolId)})`
    );
}
