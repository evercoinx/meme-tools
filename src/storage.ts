import { FlatCache, create } from "flat-cache";

export function createCache(directory: string): FlatCache {
    return create({
        cacheId: "cache.json",
        cacheDir: directory,
        ttl: 365 * 86_400 * 1_000,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}

export function createKeyring(directory: string): FlatCache {
    return create({
        cacheId: "keyring.json",
        cacheDir: directory,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}
