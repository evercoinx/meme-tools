import path from "node:path";
import { ApiV3PoolInfoStandardItemCpmm } from "@raydium-io/raydium-sdk-v2";
import { connection, envVars, logger, storage, STORAGE_DIR, STORAGE_RAYDIUM_POOL_ID } from "./init";
import { loadRaydium } from "../modules/raydium";
import { checkIfFileExists } from "../helpers/filesystem";
import { currency, decimal, percent } from "../helpers/format";

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
            feePercent = poolInfo.feeRate / 1_000_000;
        } else {
            mintASymbol = poolInfo.mintA.symbol;
            mintBSymbol = poolInfo.mintB.symbol;
            feePercent = poolInfo.feeRate;
        }

        logger.info(
            `Pool id: %s\n\t\tType: %s\n\t\tPrice: 1 %s ≈ %s %s\n\t\tFee tier: %s\n\t\tPool liquidity: %s\n\t\tPooled %s: %s\n\t\tPooled %s: %s\n\t\tLP mint id: %s\n\t\tLP supply: %s\n\t\tPermanently locked: %s`,
            poolInfo.id,
            poolInfo.type,
            mintASymbol,
            decimal.format(poolInfo.price),
            mintBSymbol,
            percent.format(feePercent),
            currency.format(poolInfo.tvl),
            mintASymbol,
            decimal.format(poolInfo.mintAmountA),
            mintBSymbol,
            decimal.format(poolInfo.mintAmountB),
            poolInfo.lpMint.address,
            decimal.format(poolInfo.lpAmount),
            percent.format(poolInfo.burnPercent)
        );
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
