import { FlatCache, create } from "flat-cache";

export function createCache(cacheDir: string): FlatCache {
    return create({
        cacheId: "meme",
        cacheDir,
        ttl: 365 * 86_400 * 1_000,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}
