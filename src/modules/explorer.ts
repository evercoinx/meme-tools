import pc from "picocolors";

export class Explorer {
    private readonly baseUri;
    private readonly cluster;

    constructor(baseUri: string, cluster: string) {
        this.baseUri = baseUri;
        this.cluster = cluster === "mainnet-beta" ? "mainnet" : cluster;
    }

    generateTransactionUri(signature: string): string {
        return pc.blue(`${this.baseUri}/tx/${signature}?cluster=${this.cluster}-alpha`);
    }

    generateAddressUri(address: string): string {
        return pc.blue(`${this.baseUri}/address/${address}?cluster=${this.cluster}-alpha`);
    }
}
