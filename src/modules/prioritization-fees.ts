import { PublicKey } from "@solana/web3.js";
import { connection } from ".";

export class PrioritizationFees {
    public static NO_FEES = 0;
    private static MAX_FETCH_FEES_REQUEST_RETRIES = 25;

    public averageFeeWithZeros: number;
    public averageFeeWithoutZeros: number;
    public medianFee: number;
    private readonly accounts: PublicKey[];

    constructor(accounts: PublicKey[]) {
        this.averageFeeWithZeros = 0;
        this.averageFeeWithoutZeros = 0;
        this.medianFee = 0;
        this.accounts = accounts;
    }

    public async fetchFees(): Promise<void> {
        let i = 0;

        do {
            await this._fetchFees();
            if (this.medianFee > 0) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 200));
            i++;
        } while (i < PrioritizationFees.MAX_FETCH_FEES_REQUEST_RETRIES);

        throw new Error("Unable to fetch prioritization fees");
    }

    private async _fetchFees(): Promise<void> {
        const prioritizationFees = await connection.getRecentPrioritizationFees({
            lockedWritableAccounts: this.accounts,
        });

        this.averageFeeWithZeros =
            prioritizationFees.length === 0
                ? 0
                : Math.floor(
                      prioritizationFees.reduce(
                          (sum, { prioritizationFee }) => sum + prioritizationFee,
                          0
                      ) / prioritizationFees.length
                  );

        const nonZeroFees = prioritizationFees
            .map(({ prioritizationFee }) => prioritizationFee)
            .filter((fee) => fee !== 0);

        this.averageFeeWithoutZeros =
            nonZeroFees.length === 0
                ? 0
                : Math.floor(nonZeroFees.reduce((sum, fee) => sum + fee, 0) / nonZeroFees.length);

        const orderedFees = nonZeroFees.sort((a, b) => a - b);
        const midIndex = Math.floor(orderedFees.length / 2);

        if (orderedFees.length > 0) {
            this.medianFee =
                orderedFees.length % 2 === 0
                    ? Math.floor((orderedFees[midIndex - 1] + orderedFees[midIndex]) / 2)
                    : orderedFees[midIndex];
        }
    }
}
