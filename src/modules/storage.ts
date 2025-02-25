import { create, FlatCache, FlatCacheEvents } from "flat-cache";
import { formatStorageFile } from "../helpers/filesystem";

export function createStorage(tokenSymbol: string, storagePath: string): FlatCache {
    const fileName = `${tokenSymbol.toLowerCase()}.json`;

    const storage = create({
        cacheId: fileName,
        cacheDir: storagePath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });

    storage.on(FlatCacheEvents.SAVE, async () => formatStorageFile(fileName));
    storage.on(FlatCacheEvents.CLEAR, async () => formatStorageFile(fileName));

    return storage;
}
