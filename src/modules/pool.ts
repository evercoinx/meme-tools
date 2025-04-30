import { Seed } from "./seed";

export class Pool<T> {
    private readonly pool: T[];
    private capacity: number;
    private currentIndex = 0;

    constructor(tokenSeed: Seed, items: T[]) {
        if (items.length === 0) {
            throw new Error("Pool cannot be empty");
        }

        this.pool = tokenSeed.shuffle(items);
        this.capacity = items.length;
    }

    public get(): T {
        const item = this.pool[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.capacity;
        return item;
    }

    public size(): number {
        return this.pool.length;
    }
}
