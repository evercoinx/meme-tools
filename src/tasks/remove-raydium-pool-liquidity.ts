import { Percent, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importKeypairFromFile, KeypairKind } from "../helpers/account";
import { checkFileExists } from "../helpers/filesystem";
import { formatDecimal, formatError, formatPublicKey } from "../helpers/format";
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
    ZERO_BN,
    ZERO_DECIMAL,
} from "../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RAYDIUM_LP_MINT_DECIMALS,
    RaydiumCpmmPool,
} from "../modules/raydium";
import { STORAGE_RAYDIUM_LP_MINT, STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const raydium = await createRaydium(connectionPool.current(), dev);
        const raydiumCpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(raydiumPoolId));

        const sendRemoveRaydiumPoolLiquidityTransaction = await removeRaydiumPoolLiquidity(
            raydium,
            raydiumCpmmPool,
            dev,
            new PublicKey(raydiumLpMint)
        );

        await Promise.all([sendRemoveRaydiumPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function removeRaydiumPoolLiquidity(
    raydium: Raydium,
    { poolInfo, poolKeys }: RaydiumCpmmPool,
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
        return Promise.resolve(undefined);
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
