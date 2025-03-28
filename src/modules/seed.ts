import { createHash } from "node:crypto";

export class Seed {
    private seed: string;
    private counter: number;

    constructor(seed: string) {
        this.seed = seed;
        this.counter = 0;
    }

    public generateRandomFloat(range: [number, number]): number {
        const randomFloat = parseInt(this.next().substring(0, 8), 16) / 0xffff_ffff;
        return range[0] + randomFloat * (range[1] - range[0]);
    }

    public generateRandomInteger(range: [number, number]): number {
        return this.hashToNumber(this.next(), range[0], range[1]);
    }

    public generateRandomBoolean(trueBiasPercent: number): boolean {
        return this.hashToNumber(this.next(), 0, 100) < trueBiasPercent;
    }

    private hashToNumber(hash: string, min: number, max: number): number {
        const integer = parseInt(hash.substring(0, 8), 16);
        return min + (integer % (max - min + 1));
    }

    private next(): string {
        const hash = createHash("sha256")
            .update(this.seed + this.counter)
            .digest("hex");

        this.counter++;

        return hash;
    }
}
