import { create, FlatCache, FlatCacheEvents } from "flat-cache";
import { formatStorage } from "../helpers/filesystem";

export function createStorage(tokenSymbol: string, storagePath: string): FlatCache {
    const cacheId = `${tokenSymbol.toLowerCase()}.json`;

    const storage = create({
        cacheId,
        cacheDir: storagePath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });

    storage.on(FlatCacheEvents.SAVE, async () => formatStorage(cacheId));

    return storage;
}
