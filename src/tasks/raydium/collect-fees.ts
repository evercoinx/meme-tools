import {
    DEV_LOCK_CPMM_AUTH,
    DEV_LOCK_CPMM_PROGRAM,
    LOCK_CPMM_AUTH,
    LOCK_CPMM_PROGRAM,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { importKeypairFromFile, KeypairKind } from "../../helpers/account";
import { checkFileExists } from "../../helpers/filesystem";
import { formatError, formatPublicKey } from "../../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../../helpers/network";
import { connectionPool, envVars, heliusClientPool, logger, storage } from "../../modules";
import { createRaydium, loadRaydiumCpmmPool } from "../../modules/raydium";
import { STORAGE_RAYDIUM_NFT_MINT, STORAGE_RAYDIUM_POOL_ID } from "../../modules/storage";

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const poolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!poolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const nftMint = storage.get<string | undefined>(STORAGE_RAYDIUM_NFT_MINT);
        if (!nftMint) {
            throw new Error("Raydium NFT mint not loaded from storage");
        }

        const sendCollectPoolFeesTransaction = await collectPoolFees(
            new PublicKey(poolId),
            dev,
            new PublicKey(nftMint)
        );

        await Promise.all([sendCollectPoolFeesTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function collectPoolFees(
    poolId: PublicKey,
    dev: Keypair,
    nftMint: PublicKey
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.get();
    const heliusClient = heliusClientPool.get();

    const raydium = await createRaydium(connection, dev);
    const { poolInfo, poolKeys } = await loadRaydiumCpmmPool(raydium, poolId);

    const {
        transaction: { instructions },
    } = await raydium.cpmm.harvestLockLp<TxVersion.LEGACY>({
        poolInfo,
        poolKeys,
        lpFeeAmount: new BN(1),
        nftMint,
        programId: raydium.cluster === "devnet" ? DEV_LOCK_CPMM_PROGRAM : LOCK_CPMM_PROGRAM,
        authProgram: raydium.cluster === "devnet" ? DEV_LOCK_CPMM_AUTH : LOCK_CPMM_AUTH,
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
        `to collect fees in pool id (${formatPublicKey(poolId)})`
    );
}
