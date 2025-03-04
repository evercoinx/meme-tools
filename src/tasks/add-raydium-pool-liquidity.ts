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
} from "../helpers/account";
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
    storage,
    ZERO_DECIMAL,
    UNITS_PER_MINT,
    ZERO_BN,
} from "../modules";
import { createRaydium, loadRaydiumCpmmPool } from "../modules/raydium";
import { STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const dev = await importKeypairFromFile(KeypairKind.Dev);

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const sendAddRaydiumPoolLiquidityTransaction = await addRaydiumPoolLiquidity(
            new PublicKey(raydiumPoolId),
            dev,
            mint
        );

        await Promise.all([sendAddRaydiumPoolLiquidityTransaction]);
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function addRaydiumPoolLiquidity(
    raydiumPoolId: PublicKey,
    dev: Keypair,
    mint: Keypair
): Promise<Promise<TransactionSignature | undefined>> {
    const connection = connectionPool.current();
    const heliusClient = heliusClientPool.current();

    const raydium = await createRaydium(connection, dev);
    const { poolInfo, poolKeys } = await loadRaydiumCpmmPool(raydium, raydiumPoolId);

    const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
        connectionPool,
        dev,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID
    );
    if (!mintTokenBalance) {
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
            "Dev (%s) has insufficient balance on ATA (%s): %s %s",
            formatPublicKey(dev.publicKey),
            formatPublicKey(mintTokenAccount),
            formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS),
            envVars.TOKEN_SYMBOL
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
        `to add liquidity to pool id (${formatPublicKey(raydiumPoolId)})`
    );
}
