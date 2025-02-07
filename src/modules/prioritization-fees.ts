import { PublicKey } from "@solana/web3.js";
import { connection } from ".";

export class PrioritizationFees {
    public averageFeeIncludingZeros: number;
    public averageFeeExcludingZeros: number;
    public medianFee: number;
    private readonly publicKey: PublicKey;

    constructor(publicKey?: PublicKey) {
        this.averageFeeIncludingZeros = 0;
        this.averageFeeExcludingZeros = 0;
        this.medianFee = 0;
        this.publicKey = publicKey ?? new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"); // Jupiter aggregator
    }

    public async fetchFees(): Promise<void> {
        const prioritizationFees = await connection.getRecentPrioritizationFees({
            lockedWritableAccounts: [this.publicKey],
        });

        this.averageFeeIncludingZeros =
            prioritizationFees.length !== 0
                ? Math.floor(
                      prioritizationFees.reduce(
                          (acc, { prioritizationFee }) => acc + prioritizationFee,
                          0
                      ) / prioritizationFees.length
                  )
                : 0;

        const nonZeroFees = prioritizationFees
            .map(({ prioritizationFee }) => prioritizationFee)
            .filter((fee) => fee !== 0);

        this.averageFeeExcludingZeros =
            nonZeroFees.length !== 0
                ? Math.floor(nonZeroFees.reduce((acc, fee) => acc + fee, 0) / nonZeroFees.length)
                : 0;

        if (nonZeroFees.length !== 0) {
            const sortedFees = nonZeroFees.sort((a, b) => a - b);
            const midIndex = Math.floor(sortedFees.length / 2);

            this.medianFee =
                sortedFees.length % 2 !== 0
                    ? sortedFees[midIndex]
                    : Math.floor((sortedFees[midIndex - 1] + sortedFees[midIndex]) / 2);
        }
    }
}
