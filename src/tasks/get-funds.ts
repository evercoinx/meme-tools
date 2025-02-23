import "../init";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import pc from "picocolors";
import {
    getSolBalance,
    getTokenAccountInfo,
    importLocalKeypair,
    importMintKeypair,
    importSwapperKeypairs,
} from "../helpers/account";
import { checkIfStorageExists } from "../helpers/filesystem";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import {
    connectionPool,
    envVars,
    logger,
    OUTPUT_UNKNOWN_KEY,
    RAYDIUM_LP_MINT_DECIMALS,
    storage,
    STORAGE_RAYDIUM_LP_MINT,
    SwapperType,
} from "../modules";

(async () => {
    try {
        await checkIfStorageExists(storage.cacheId);

        const dev = await importLocalKeypair(envVars.DEV_KEYPAIR_PATH, "dev");
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );
        const snipers = importSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = importSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);
        const mint = importMintKeypair();

        await getFunds(dev, distributor, snipers, traders, mint);
        process.exit(0);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getFunds(
    dev: Keypair,
    distributor: Keypair,
    snipers: Keypair[],
    traders: Keypair[],
    mint?: Keypair
): Promise<void> {
    for (const [i, account] of [dev, distributor, ...snipers, ...traders].entries()) {
        const isDev = i === 0;
        const isDistributor = i === 1;
        const isSniper = i >= 2 && i < 2 + snipers.length;

        const solBalance = await getSolBalance(connectionPool, account);

        let mintTokenAccount: PublicKey | undefined;
        let mintTokenBalance: Decimal | undefined;
        if (mint) {
            [mintTokenAccount, mintTokenBalance] = await getTokenAccountInfo(
                connectionPool,
                account,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID
            );
        }

        const logParams = [
            formatPublicKey(account.publicKey, "long"),
            formatDecimal(solBalance.div(LAMPORTS_PER_SOL)),
            mintTokenAccount ? formatPublicKey(mintTokenAccount, "long") : OUTPUT_UNKNOWN_KEY,
            mintTokenBalance
                ? formatDecimal(
                      mintTokenBalance.div(10 ** envVars.TOKEN_DECIMALS),
                      envVars.TOKEN_DECIMALS
                  )
                : pc.green("?"),
            envVars.TOKEN_SYMBOL,
        ];

        if (isDev) {
            let lpMintTokenAccount: PublicKey | undefined;
            let lpMintTokenBalance: Decimal | undefined;

            const lpMint = storage.get<string | undefined>(STORAGE_RAYDIUM_LP_MINT);
            if (lpMint) {
                [lpMintTokenAccount, lpMintTokenBalance] = await getTokenAccountInfo(
                    connectionPool,
                    account,
                    new PublicKey(lpMint),
                    TOKEN_PROGRAM_ID
                );
            }

            logger.info(
                "Dev funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n\t\t%s - %s LP-%s\n",
                ...logParams,
                lpMintTokenAccount
                    ? formatPublicKey(lpMintTokenAccount, "long")
                    : OUTPUT_UNKNOWN_KEY,
                lpMintTokenBalance
                    ? formatDecimal(
                          lpMintTokenBalance.div(10 ** RAYDIUM_LP_MINT_DECIMALS),
                          RAYDIUM_LP_MINT_DECIMALS
                      )
                    : pc.green("?"),
                envVars.TOKEN_SYMBOL
            );
        } else {
            logger.info(
                "%s funds\n\t\t%s - %s SOL\n\t\t%s - %s %s\n",
                isDistributor
                    ? "Distributor"
                    : isSniper
                      ? `Sniper #${i - 2}`
                      : `Trader #${i - 2 - snipers.length}`,
                ...logParams
            );
        }
    }
}
