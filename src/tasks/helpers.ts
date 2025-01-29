import fs from "node:fs/promises";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function lamportsToSol(lamports: bigint | number, decimals = 3) {
    if (lamports > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Too high amount for representation: ${lamports}`);
    }

    const sol = Number(lamports) / LAMPORTS_PER_SOL;
    return sol.toFixed(decimals);
}

export async function checkIfFileExists(path: string) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}
