import { PublicKey } from "@solana/web3.js";
import { connection } from ".";

export class PrioritizationFees {
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

        this.medianFee =
            orderedFees.length % 2 === 0
                ? Math.floor((orderedFees[midIndex - 1] + orderedFees[midIndex]) / 2)
                : orderedFees[midIndex];
    }
}
