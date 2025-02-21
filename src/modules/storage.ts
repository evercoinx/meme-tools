import { create, FlatCache, FlatCacheEvents } from "flat-cache";
import { formatStorage } from "../helpers/filesystem";

export function createStorage(scope: string, storagePath: string): FlatCache {
    const cacheId = `${scope.toLowerCase()}.json`;

    const storage = create({
        cacheId,
        cacheDir: storagePath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });

    storage.on(FlatCacheEvents.SAVE, async () => formatStorage(cacheId));

    return storage;
}
