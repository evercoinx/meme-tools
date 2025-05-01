import { parseArgs } from "node:util";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PriorityLevel } from "helius-sdk";
import {
    importSwapperKeypairs,
    importMintKeypair,
    KeypairKind,
    getSolBalance,
    getTokenAccountInfo,
} from "../../helpers/account";
import { checkFileExists } from "../../helpers/filesystem";
import { formatDecimal, formatError, formatPublicKey } from "../../helpers/format";
import {
    connectionPool,
    envVars,
    heliusClientPool,
    logger,
    storage,
    SWAPPER_SLIPPAGE_PERCENT,
    ZERO_DECIMAL,
} from "../../modules";
import {
    createRaydium,
    loadRaydiumCpmmPool,
    RaydiumCpmmPool,
    swapMintToSol,
    swapSolToMint,
} from "../../modules/raydium";
import { STORAGE_RAYDIUM_POOL_ID } from "../../modules/storage";

enum SwapType {
    Buy = "buy",
    Sell = "sell",
}

(async () => {
    try {
        await checkFileExists(storage.cacheFilePath);

        const {
            values: { index, "swap-type": swapType },
        } = parseArgs({
            options: {
                index: {
                    type: "string",
                },
                "swap-type": {
                    type: "string",
                },
            },
        });
        if (!index || parseInt(index, 10)) {
            throw new Error(`Invalid whale index: ${index}`);
        }
        const parsedIndex = parseInt(index, 10);

        if (!swapType || ![SwapType.Buy, SwapType.Sell].includes(swapType as SwapType)) {
            throw new Error(`Invalid swap type: ${swapType}`);
        }

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not loaded from storage");
        }

        const poolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!poolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const whales = importSwapperKeypairs(KeypairKind.Whale);
        if (parsedIndex >= whales.length) {
            throw new Error("Whale not found");
        }
        const whale = whales[parsedIndex];

        const raydium = await createRaydium(connectionPool.get(), whale);
        const cpmmPool = await loadRaydiumCpmmPool(raydium, new PublicKey(poolId));

        const sendSwapTransaction =
            swapType === SwapType.Buy
                ? await buyMint(raydium, cpmmPool, whale)
                : await sellMint(raydium, cpmmPool, whale, mint);

        await Promise.all([sendSwapTransaction]);

        process.exit(0);
    } catch (error: unknown) {
        logger.fatal(formatError(error));
        process.exit(1);
    }
})();

async function buyMint(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    account: Keypair
): Promise<Promise<TransactionSignature | undefined>[] | undefined> {
    const solBalance = await getSolBalance(connectionPool, account);
    const lamports = solBalance.sub(
        new Decimal(envVars.WHALE_BALANCE_SOL).mul(LAMPORTS_PER_SOL).trunc()
    );

    if (lamports.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Whale (%s) has insufficient balance on wallet: %s SOL",
            formatPublicKey(account.publicKey),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
        );
        return;
    }

    return swapSolToMint(
        connectionPool,
        heliusClientPool,
        raydium,
        cpmmPool,
        [account],
        [new BN(lamports.toFixed(0))],
        SWAPPER_SLIPPAGE_PERCENT,
        PriorityLevel.DEFAULT
    );
}

async function sellMint(
    raydium: Raydium,
    cpmmPool: RaydiumCpmmPool,
    account: Keypair,
    mint: Keypair
): Promise<Promise<TransactionSignature | undefined>[] | undefined> {
    const [mintTokenAccount, mintTokenBalance, mintTokenInitialized] = await getTokenAccountInfo(
        connectionPool,
        account,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID
    );

    if (!mintTokenInitialized) {
        logger.warn(
            "Whale (%s) has uninitialized %s ATA (%s)",
            formatPublicKey(account.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(mintTokenAccount)
        );
        return;
    }
    if (mintTokenBalance.lte(ZERO_DECIMAL)) {
        logger.warn(
            "Whale (%s) has zero balance on %s ATA (%s)",
            formatPublicKey(account.publicKey),
            envVars.TOKEN_SYMBOL,
            formatPublicKey(mintTokenAccount)
        );
        return;
    }

    return swapMintToSol(
        connectionPool,
        heliusClientPool,
        raydium,
        cpmmPool,
        [account],
        [new BN(mintTokenBalance.toFixed(0))],
        SWAPPER_SLIPPAGE_PERCENT,
        PriorityLevel.DEFAULT
    );
}
