import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";

export class Explorer {
    private readonly baseUri;
    private readonly cluster;

    constructor(baseUri: string, cluster: "mainnet-beta" | "devnet") {
        this.baseUri = baseUri;

        if (baseUri.includes("solana.fm")) {
            switch (cluster) {
                case "mainnet-beta":
                    this.cluster = "mainnet-alpha";
                    return;
                case "devnet":
                    this.cluster = "devnet-alpha";
                    return;
            }
        } else if (baseUri.includes("explorer.solana.com")) {
            switch (cluster) {
                case "mainnet-beta":
                    this.cluster = "mainnet-beta";
                    return;
                case "devnet":
                    this.cluster = "devnet";
                    return;
            }
        }

        throw new Error(`Unknown base URI: ${baseUri}`);
    }

    generateTransactionUri(signature: string): string {
        return chalk.blue(`${this.baseUri}/tx/${signature}?cluster=${this.cluster}`);
    }

    generateAddressUri(address: string | PublicKey): string {
        const normalizedAddress = address instanceof PublicKey ? address.toBase58() : address;
        return chalk.blue(`${this.baseUri}/address/${normalizedAddress}?cluster=${this.cluster}`);
    }
}
