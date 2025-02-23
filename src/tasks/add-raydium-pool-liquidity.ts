import "../init";
import { Percent, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionSignature } from "@solana/web3.js";
import { BN } from "bn.js";
import { PriorityLevel } from "helius-sdk";
import { getTokenAccountInfo, importLocalKeypair, importMintKeypair } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
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
    STORAGE_RAYDIUM_POOL_ID,
    ZERO_DECIMAL,
    UNITS_PER_MINT,
    ZERO_BN,
} from "../modules";
import { loadRaydium, loadRaydiumPoolInfo } from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
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

    const raydium = await loadRaydium(connection, dev);
    const { poolInfo, poolKeys } = await loadRaydiumPoolInfo(connection, raydiumPoolId, mint);

    const [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
        connectionPool,
        dev,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID
    );

    if (!mintTokenBalance) {
        throw new Error(
            `Dev (${formatPublicKey(dev.publicKey)}) has uninitialized ${envVars.TOKEN_SYMBOL} ATA (${formatPublicKey(mintTokenAccount)})`
        );
    }
    if (mintTokenBalance.lte(ZERO_DECIMAL)) {
        throw new Error(
            `Dev (${formatPublicKey(dev.publicKey)}) has insufficient balance on ATA (${formatPublicKey(mintTokenAccount)}): ${formatDecimal(mintTokenBalance.div(UNITS_PER_MINT), envVars.TOKEN_DECIMALS)} ${envVars.TOKEN_SYMBOL}`
        );
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
        `to add liquidity to pool id ${raydiumPoolId}`
    );
}
