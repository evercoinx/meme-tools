import { FlatCache, create } from "flat-cache";

export function createStorage(dirPath: string, id: string): FlatCache {
    return create({
        cacheId: `${id.toLowerCase()}.json`,
        cacheDir: dirPath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });
}
