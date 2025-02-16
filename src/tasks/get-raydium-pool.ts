import { ApiV3PoolInfoStandardItemCpmm } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import Decimal from "decimal.js";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatCurrency, formatDate, formatDecimal, formatPercent } from "../helpers/format";
import {
    connectionPool,
    envVars,
    logger,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { loadRaydium } from "../modules/raydium";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool not loaded from storage");
        }

        await getPool(raydiumPoolId);
        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getPool(raydiumPoolId: string): Promise<void> {
    const raydium = await loadRaydium(connectionPool.next());
    let poolInfo: ApiV3PoolInfoStandardItemCpmm;

    if (raydium.cluster === "devnet") {
        const data = await raydium.cpmm.getPoolInfoFromRpc(raydiumPoolId);
        poolInfo = data.poolInfo;
    } else {
        const data = await raydium.api.fetchPoolById({ ids: raydiumPoolId });
        poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm;
    }
    if (!poolInfo) {
        throw new Error(`CPMM pool not found: ${raydiumPoolId}`);
    }

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
        "Raydium pool (%s)\n\t\tPool id: %s\n\t\t%s mint: %s\n\t\t%s mint: %s\n\t\tLP mint: %s\n\t\tPool type: %s\n\t\tBase price: 1 %s ≈ %s %s\n\t\tQuote price: 1 %s ≈ %s %s\n\t\tFee tier: %s\n\t\tOpen time: %s\n\t\tPool liquidity: %s\n\t\tPooled %s: %s\n\t\tPooled %s: %s\n\t\tLP supply: %s\n\t\tPermanently locked: %s",
        raydium.cluster,
        id,
        mintA.symbol,
        mintA.address,
        mintB.symbol,
        mintB.address,
        lpMint.address,
        type,
        mintA.symbol,
        formatDecimal(
            price,
            NATIVE_MINT.toBase58() === mintA.address ? mintA.decimals : mintB.decimals
        ),
        mintB.symbol,
        mintB.symbol,
        formatDecimal(
            new Decimal(1).div(price),
            NATIVE_MINT.toBase58() !== mintA.address ? mintA.decimals : mintB.decimals
        ),
        mintA.symbol,
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
