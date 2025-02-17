import { shuffle } from "../helpers/random";

export class Pool<T> {
    private readonly pool: T[];
    private capacity: number;
    private currentIndex = 0;

    constructor(items: T[]) {
        if (items.length === 0) {
            throw new Error("Pool must be initialized with at least one item");
        }

        this.pool = shuffle(items);
        this.capacity = items.length;
    }

    current(): T {
        return this.pool[this.currentIndex];
    }

    next(): T {
        const item = this.pool[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.capacity;
        return item;
    }
}
