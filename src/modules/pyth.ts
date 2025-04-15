import { PythHttpClient, getPythProgramKeyForCluster } from "@pythnetwork/client";
import { Connection } from "@solana/web3.js";
import Decimal from "decimal.js";
import { formatInteger, formatText } from "../helpers/format";
import { RpcCluster } from "./environment";
import { Pool } from "./pool";

const SYMBOL_SOL_TO_USD = "Crypto.SOL/USD";

export class Pyth {
    private readonly pythClient: PythHttpClient;

    constructor(connectionPool: Pool<Connection>, rpcCluster: RpcCluster) {
        const pythPublicKey = getPythProgramKeyForCluster(rpcCluster);
        this.pythClient = new PythHttpClient(connectionPool.current(), pythPublicKey);
    }

    async getUsdPriceForSol(): Promise<Decimal> {
        const data = await this.pythClient.getData();

        if (!data.symbols.includes(SYMBOL_SOL_TO_USD)) {
            throw new Error(`Symbol not found: ${formatText(SYMBOL_SOL_TO_USD)}`);
        }

        const symbolPrice = data.productPrice.get(SYMBOL_SOL_TO_USD);
        if (!symbolPrice?.aggregate) {
            throw new Error(`Failed to fetch price for ${formatText(SYMBOL_SOL_TO_USD)}`);
        }

        const { price, confidence, status } = symbolPrice.aggregate;
        if (!price || !confidence) {
            throw new Error(`Price unavailable. Status: ${formatInteger(status)}`);
        }

        return new Decimal(price);
    }
}
