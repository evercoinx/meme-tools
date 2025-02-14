import { create, FlatCache, FlatCacheEvents } from "flat-cache";
import { formatStorage } from "../helpers/filesystem";

export function createStorage(dirPath: string, id: string): FlatCache {
    const cacheId = `${id.toLowerCase()}.json`;
    const storage = create({
        cacheId,
        cacheDir: dirPath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });

    storage.on(FlatCacheEvents.SAVE, async () => formatStorage(cacheId));

    return storage;
}
