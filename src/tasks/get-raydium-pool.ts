import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import { checkIfStorageFileExists } from "../helpers/filesystem";
import {
    formatCurrency,
    formatDate,
    formatDecimal,
    formatPercent,
    formatPublicKey,
} from "../helpers/format";
import { connectionPool, envVars, logger, storage } from "../modules";
import { createRaydium, loadRaydiumCpmmPool, RAYDIUM_LP_MINT_DECIMALS } from "../modules/raydium";
import { STORAGE_RAYDIUM_POOL_ID } from "../modules/storage";

(async () => {
    try {
        await checkIfStorageFileExists(storage.cacheId);

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool not loaded from storage");
        }

        await getPool(new PublicKey(raydiumPoolId));
        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(error);
        process.exit(1);
    }
})();

async function getPool(raydiumPoolId: PublicKey): Promise<void> {
    const raydium = await createRaydium(connectionPool.current());
    const { poolInfo } = await loadRaydiumCpmmPool(raydium, raydiumPoolId);

    const {
        id,
        mintAmountA,
        mintAmountB,
        lpMint,
        lpAmount,
        type,
        price,
        openTime,
        tvl,
        burnPercent,
    } = poolInfo;
    let { mintA, mintB, feeRate } = poolInfo;

    if (raydium.cluster === "devnet") {
        const wsolParams = {
            symbol: "WSOL",
            name: "Wrapped SOL",
            decimals: 9,
        };
        const tokenParams = {
            symbol: envVars.TOKEN_SYMBOL,
            name: envVars.TOKEN_SYMBOL,
            decimals: envVars.TOKEN_DECIMALS,
        };

        if (mintA.address === NATIVE_MINT.toBase58()) {
            mintA = { ...mintA, ...wsolParams };
            mintB = { ...mintB, ...tokenParams };
        } else {
            mintA = { ...mintA, ...tokenParams };
            mintB = { ...mintB, ...wsolParams };
        }

        feeRate = feeRate / 1e6;
    }

    logger.info(
        "Raydium pool (%s)\n\t\tPool id: %s\n\t\t%s mint: %s\n\t\t%s mint: %s\n\t\tLP mint: %s\n\t\tPool type: %s\n\t\tPrice: %s %s ≈ %s %s\n\t\tFee tier: %s\n\t\tOpen time: %s\n\t\tPool liquidity: %s\n\t\tPooled %s: %s\n\t\tPooled %s: %s\n\t\tLP supply: %s\n\t\tPermanently locked: %s",
        raydium.cluster,
        formatPublicKey(id, "long"),
        mintA.symbol,
        formatPublicKey(mintA.address, "long"),
        mintB.symbol,
        formatPublicKey(mintB.address, "long"),
        formatPublicKey(lpMint.address, "long"),
        chalk.yellow(type),
        formatDecimal(1, 0),
        ...(NATIVE_MINT.toBase58() === mintA.address
            ? [mintA.symbol, formatDecimal(price, mintA.decimals), mintB.symbol]
            : [mintB.symbol, formatDecimal(price, mintB.decimals), mintA.symbol]),
        formatPercent(feeRate),
        formatDate(Number(openTime)),
        formatCurrency(tvl),
        mintA.symbol,
        formatDecimal(mintAmountA, 9),
        mintB.symbol,
        formatDecimal(mintAmountB, envVars.TOKEN_DECIMALS),
        formatDecimal(lpAmount / 10 ** RAYDIUM_LP_MINT_DECIMALS, RAYDIUM_LP_MINT_DECIMALS),
        formatPercent(burnPercent / 1e2)
    );
}
