import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";

export class Explorer {
    private readonly baseUri;
    private readonly cluster;

    constructor(baseUri: string, cluster: string) {
        this.baseUri = baseUri;
        this.cluster = cluster === "mainnet-beta" ? "mainnet" : cluster;
    }

    generateTransactionUri(signature: string): string {
        return chalk.blue(`${this.baseUri}/tx/${signature}?cluster=${this.cluster}-alpha`);
    }

    generateAddressUri(address: string | PublicKey): string {
        const normalizedAddress = address instanceof PublicKey ? address.toBase58() : address;
        return chalk.blue(
            `${this.baseUri}/address/${normalizedAddress}?cluster=${this.cluster}-alpha`
        );
    }
}
