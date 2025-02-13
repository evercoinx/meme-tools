import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { importMintKeypair, importSwapperKeypairs } from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import {
    connection,
    envVars,
    logger,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    STORAGE_RAYDIUM_POOL_ID,
    STORAGE_SNIPER_SECRET_KEYS,
    SwapperType,
} from "../modules";
import { loadRaydiumPoolInfo, swapMintToSol } from "../modules/raydium";

const SLIPPAGE = 0.3;
const ZERO_BN = new BN(0);

(async () => {
    try {
        await checkIfStorageExists();

        const mint = importMintKeypair();
        if (!mint) {
            throw new Error("Mint not imported");
        }

        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper,
            STORAGE_SNIPER_SECRET_KEYS
        );

        const raydiumPoolId = storage.get<string | undefined>(STORAGE_RAYDIUM_POOL_ID);
        if (!raydiumPoolId) {
            throw new Error("Raydium pool id not loaded from storage");
        }

        const raydiumLpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
        if (!raydiumLpMint) {
            throw new Error("Raydium LP mint not loaded from storage");
        }

        const poolInfo = await loadRaydiumPoolInfo(connection, new PublicKey(raydiumPoolId), mint);
        const unitsToSwap = await findUnitsToSwap(snipers, mint);
        const sendSwapMintToSolTransactions = await swapMintToSol(
            connection,
            poolInfo,
            snipers,
            unitsToSwap,
            SLIPPAGE,
            "VeryHigh",
            { skipPreflight: true }
        );
        await Promise.all(sendSwapMintToSolTransactions);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function findUnitsToSwap(snipers: Keypair[], mint: Keypair): Promise<(BN | null)[]> {
    const unitsToSwap: (BN | null)[] = [];

    for (const [i, sniper] of snipers.entries()) {
        const mintTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            sniper.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        let mintBalance = ZERO_BN;

        try {
            const mintTokenAccountBalance = await connection.getTokenAccountBalance(
                mintTokenAccount,
                "confirmed"
            );
            mintBalance = new BN(mintTokenAccountBalance.value.amount.toString());
        } catch {
            // Ignore TokenAccountNotFoundError error
        }

        if (mintBalance.lte(ZERO_BN)) {
            unitsToSwap[i] = null;
            continue;
        }

        unitsToSwap[i] = mintBalance;
    }

    return unitsToSwap;
}
