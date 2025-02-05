import { ApiV3PoolInfoStandardItemCpmm } from "@raydium-io/raydium-sdk-v2";
import { connection, envVars, logger, RAYDIUM_LP_MINT_DECIMALS } from "../modules";
import { loadRaydium } from "../modules/raydium";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatCurrency, formatDate, formatDecimal, formatPercent } from "../helpers/format";
import Decimal from "decimal.js";
import { importRaydiumPoolId } from "../helpers/account";

(async () => {
    try {
        await checkIfStorageExists();

        if (!["devnet", "mainnet-beta"].includes(envVars.CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.CLUSTER}`);
        }

        const raydiumPoolId = importRaydiumPoolId();
        if (!raydiumPoolId) {
            throw new Error("Raydium pool not imported");
        }

        const raydium = await loadRaydium(envVars.CLUSTER, connection);

        let poolInfo: ApiV3PoolInfoStandardItemCpmm;
        if (raydium.cluster === "devnet") {
            const data = await raydium.cpmm.getPoolInfoFromRpc(raydiumPoolId.toBase58());
            poolInfo = data.poolInfo;
            // Price fix when API returns 5 decimal places
            poolInfo.price = new Decimal(poolInfo.price.toString().replace(".", ""))
                .div(10 ** envVars.TOKEN_DECIMALS)
                .toNumber();
        } else {
            const data = await raydium.api.fetchPoolById({ ids: raydiumPoolId.toBase58() });
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
            poolInfo.id,
            mintASymbol,
            poolInfo.mintA.address,
            mintBSymbol,
            poolInfo.mintB.address,
            poolInfo.lpMint.address,
            poolInfo.type,
            mintASymbol,
            formatDecimal(poolInfo.price, envVars.TOKEN_DECIMALS),
            mintBSymbol,
            formatPercent(feePercent),
            formatDate(Number(poolInfo.openTime)),
            formatCurrency(poolInfo.tvl),
            mintASymbol,
            formatDecimal(poolInfo.mintAmountA, 9),
            mintBSymbol,
            formatDecimal(poolInfo.mintAmountB, envVars.TOKEN_DECIMALS),
            formatDecimal(
                poolInfo.lpAmount / 10 ** RAYDIUM_LP_MINT_DECIMALS,
                RAYDIUM_LP_MINT_DECIMALS
            ),
            formatPercent(poolInfo.burnPercent / 1e2)
        );
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();
