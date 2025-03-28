import { randomBytes, randomInt } from "node:crypto";

export function generateRandomFloat(range: [number, number]): number {
    const randomFloat = randomBytes(4).readUInt32LE(0) / 0xffff_ffff;
    return randomFloat * (range[1] - range[0]) + range[0];
}

export function generateRandomInteger(range: [number, number]): number {
    return randomInt(range[0], range[1] + 1);
}

export function generateRandomBoolean(trueBiasPercent: number): boolean {
    return randomInt(100) < trueBiasPercent;
}

export function shuffle<T>(items: T[]): T[] {
    return items.length < 2
        ? items
        : items
              .map((value) => ({ value, sort: randomBytes(4).readUInt32LE(0) }))
              .sort((a, b) => a.sort - b.sort)
              .map(({ value }) => value);
}
