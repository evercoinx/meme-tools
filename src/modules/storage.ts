import { create, FlatCache, FlatCacheEvents } from "flat-cache";
import { formatStorageFile } from "../helpers/filesystem";

export const STORAGE_MINT_IMAGE_URI = "mint_image_uri";
export const STORAGE_MINT_METADATA = "mint_metadata";
export const STORAGE_MINT_SECRET_KEY = "mint_secret_key";
export const STORAGE_RAYDIUM_LP_MINT = "raydium_lp_mint";
export const STORAGE_RAYDIUM_POOL_ID = "raydium_pool_id";
export const STORAGE_RAYDIUM_POOL_TRADING_CYCLE = "raydium_pool_trading_cycle";
export const STORAGE_SNIPER_COUNT = "sniper_count";
export const STORAGE_TRADER_COUNT = "trader_count";

export function createStorage(dirPath: string, tokenSymbol: string): FlatCache {
    const fileName = `${tokenSymbol.toLowerCase()}.json`;

    const storage = create({
        cacheId: fileName,
        cacheDir: dirPath,
        deserialize: JSON.parse,
        serialize: JSON.stringify,
    });

    storage.on(FlatCacheEvents.SAVE, async () => formatStorageFile(storage.cacheFilePath));
    storage.on(FlatCacheEvents.CLEAR, async () => formatStorageFile(storage.cacheFilePath));

    return storage;
}
