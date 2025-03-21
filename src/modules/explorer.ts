import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import { formatUri, generateLink } from "../helpers/format";
import { RpcCluster } from "./environment";

const SOLANA_COM = "explorer.solana.com";
const SOLANA_FM = "solana.fm";
const SOLSCAN_IO = "solscan.io";

export class Explorer {
    private readonly baseUri;
    private readonly cluster;

    constructor(baseUri: string, cluster: RpcCluster) {
        this.baseUri = baseUri;

        if (baseUri.includes(SOLANA_COM) || baseUri.includes(SOLSCAN_IO)) {
            switch (cluster) {
                case "mainnet-beta":
                    this.cluster = "mainnet-beta";
                    return;
                case "devnet":
                    this.cluster = "devnet";
                    return;
            }
        } else if (baseUri.includes(SOLANA_FM)) {
            switch (cluster) {
                case "mainnet-beta":
                    this.cluster = "mainnet-alpha";
                    return;
                case "devnet":
                    this.cluster = "devnet-alpha";
                    return;
            }
        }

        throw new Error(`Unknown base URI: ${formatUri(baseUri)}`);
    }

    public generateTransactionUri(signature: string, tag = "<Transaction link>"): string {
        return chalk.blue(
            generateLink(`${this.baseUri}/tx/${signature}?cluster=${this.cluster}`, tag)
        );
    }

    public generateAddressUri(address: string | PublicKey, tag = "<Address link>"): string {
        const normalizedAddress = address instanceof PublicKey ? address.toBase58() : address;
        return chalk.blue(
            generateLink(
                `${this.baseUri}/address/${normalizedAddress}?cluster=${this.cluster}`,
                tag
            )
        );
    }

    public generateTokenUri(address: string | PublicKey, tag = "<Token link>"): string {
        const normalizedAddress = address instanceof PublicKey ? address.toBase58() : address;
        const tokenPath = this.baseUri.includes(SOLSCAN_IO) ? "token" : "address";
        return chalk.blue(
            generateLink(
                `${this.baseUri}/${tokenPath}/${normalizedAddress}?cluster=${this.cluster}`,
                tag
            )
        );
    }
}
