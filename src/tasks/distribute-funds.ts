import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { generateOrImportSwapperKeypairs, importLocalKeypair } from "../helpers/account";
import { formatDecimal, formatPublicKey } from "../helpers/format";
import { sendAndConfirmVersionedTransaction } from "../helpers/network";
import { getRandomFloat } from "../helpers/random";
import { connectionPool, envVars, heliusClientPool, logger, SwapperType } from "../modules";
import { HeliusClient } from "../modules/helius";

(async () => {
    try {
        const distributor = await importLocalKeypair(
            envVars.DISTRIBUTOR_KEYPAIR_PATH,
            "distributor"
        );

        const snipers = generateOrImportSwapperKeypairs(
            envVars.SNIPER_SHARE_POOL_PERCENTS.length,
            SwapperType.Sniper
        );
        const traders = generateOrImportSwapperKeypairs(envVars.TRADER_COUNT, SwapperType.Trader);

        const sniperAmounts = envVars.SNIPER_SHARE_POOL_PERCENTS.map((percent) =>
            new Decimal(envVars.INITIAL_POOL_LIQUIDITY_SOL)
                .mul(percent)
                .plus(envVars.INITIAL_SWAPPER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
        );
        const traderAmounts = new Array(envVars.TRADER_COUNT).fill(0).map(() => {
            const amount = new Decimal(getRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL));
            return amount.plus(envVars.INITIAL_SWAPPER_BALANCE_SOL).mul(LAMPORTS_PER_SOL);
        });

        const sendDistrubuteSniperFundsTransaction = await distributeFunds(
            sniperAmounts,
            distributor,
            snipers
        );
        const sendDistrubuteTraderFundsTransaction = await distributeFunds(
            traderAmounts,
            distributor,
            traders
        );

        await Promise.all([
            sendDistrubuteSniperFundsTransaction,
            sendDistrubuteTraderFundsTransaction,
        ]);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function distributeFunds(
    lamports: Decimal[],
    distributor: Keypair,
    accounts: Keypair[]
): Promise<Promise<void>> {
    let connection: Connection | undefined;
    let heliusCleint: HeliusClient | undefined;
    const instructions: TransactionInstruction[] = [];

    for (const [i, account] of accounts.entries()) {
        connection = connectionPool.next();
        heliusCleint = heliusClientPool.next();

        const solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));

        if (solBalance.gte(lamports[i])) {
            logger.warn(
                "Sniper #%d (%s) has sufficient balance: %s SOL",
                i,
                formatPublicKey(account.publicKey),
                formatDecimal(solBalance.div(LAMPORTS_PER_SOL))
            );
        } else {
            const residualLamports = lamports[i].sub(solBalance);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: distributor.publicKey,
                    toPubkey: account.publicKey,
                    lamports: residualLamports.trunc().toNumber(),
                })
            );
        }

        const wsolTokenAccount = getAssociatedTokenAddressSync(
            NATIVE_MINT,
            account.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const wsolAccountInfo = await connection.getAccountInfo(wsolTokenAccount, "confirmed");
        if (wsolAccountInfo) {
            logger.warn(
                "WSOL ATA (%s) exists for account #%d (%s)",
                wsolTokenAccount.toBase58(),
                i,
                account.publicKey.toBase58()
            );
        } else {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    distributor.publicKey,
                    wsolTokenAccount,
                    account.publicKey,
                    NATIVE_MINT,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )
            );
        }
    }

    return connection && heliusCleint && instructions.length > 0
        ? sendAndConfirmVersionedTransaction(
              connection,
              heliusCleint,
              instructions,
              [distributor],
              `to distribute funds from distributor (${formatPublicKey(distributor.publicKey)}) to ${accounts.length} accounts`,
              "Low"
          )
        : Promise.resolve();
}
