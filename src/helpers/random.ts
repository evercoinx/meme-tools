import { randomBytes } from "node:crypto";

export function getRandomFloat(range: [number, number]): number {
    const randomFloat = randomBytes(4).readUInt32LE(0) / 0xffffffff;
    return randomFloat * (range[1] - range[0]) + range[0];
}

export function shuffle(arr: unknown[]): unknown[] {
    return arr
        .map((val) => ({ val, sort: randomBytes(4).readUInt32LE(0) }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ val }) => val);
}
