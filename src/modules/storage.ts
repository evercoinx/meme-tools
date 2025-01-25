import { FlatCache, create } from "flat-cache";

export function createCache(dirPath: string): FlatCache {
    return create({
        cacheId: "cache.json",
        cacheDir: dirPath,
        ttl: 365 * 86_400 * 1_000,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}

export function createKeyring(dirPath: string): FlatCache {
    return create({
        cacheId: "keyring.json",
        cacheDir: dirPath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}
