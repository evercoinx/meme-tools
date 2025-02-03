import path from "node:path";
import { ApiV3PoolInfoStandardItemCpmm } from "@raydium-io/raydium-sdk-v2";
import {
    connection,
    envVars,
    explorer,
    logger,
    storage,
    STORAGE_DIR,
    STORAGE_RAYDIUM_POOL_ID,
} from "../modules";
import { loadRaydium } from "../modules/raydium";
import { checkIfFileExists } from "../helpers/filesystem";
import { currency, date, decimal, percent } from "../helpers/format";

(async () => {
    try {
        if (!["devnet", "mainnet-beta"].includes(envVars.CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.CLUSTER}`);
        }

        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error(`Raydium pool not found: ${raydiumPoolId}`);
        }

        const raydium = await loadRaydium(envVars.CLUSTER, connection);

        let poolInfo: ApiV3PoolInfoStandardItemCpmm;
        if (raydium.cluster === "devnet") {
            const data = await raydium.cpmm.getPoolInfoFromRpc(raydiumPoolId);
            poolInfo = data.poolInfo;
        } else {
            const data = await raydium.api.fetchPoolById({ ids: raydiumPoolId });
            poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm;
        }

        let mintASymbol: string;
        let mintBSymbol: string;
        let feePercent: number;
        if (raydium.cluster === "devnet") {
            mintASymbol = "WSOL";
            mintBSymbol = envVars.TOKEN_SYMBOL;
            feePercent = poolInfo.feeRate / 1e6;
        } else {
            mintASymbol = poolInfo.mintA.symbol;
            mintBSymbol = poolInfo.mintB.symbol;
            feePercent = poolInfo.feeRate;
        }

        logger.info(
            `Raydium pool info (%s)\n\t\tPool id: %s\n\t\t%s mint: %s\n\t\t%s mint: %s\n\t\tLP mint: %s\n\t\tPool type: %s\n\t\tPrice: 1 %s ≈ %s %s\n\t\tFee tier: %s\n\t\tOpen time: %s\n\t\tPool liquidity: %s\n\t\tPooled %s: %s\n\t\tPooled %s: %s\n\t\tLP supply: %s\n\t\tPermanently locked: %s`,
            raydium.cluster,
            explorer.generateAddressUri(poolInfo.id),
            mintASymbol,
            explorer.generateAddressUri(poolInfo.mintA.address),
            mintBSymbol,
            explorer.generateAddressUri(poolInfo.mintB.address),
            explorer.generateAddressUri(poolInfo.lpMint.address),
            poolInfo.type,
            mintASymbol,
            decimal.format(poolInfo.price),
            mintBSymbol,
            percent.format(feePercent),
            date.format(new Date(Number(poolInfo.openTime) * 1e3)),
            currency.format(poolInfo.tvl),
            mintASymbol,
            decimal.format(poolInfo.mintAmountA),
            mintBSymbol,
            decimal.format(poolInfo.mintAmountB),
            decimal.format(poolInfo.lpAmount),
            percent.format(poolInfo.burnPercent / 1e2)
        );
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
