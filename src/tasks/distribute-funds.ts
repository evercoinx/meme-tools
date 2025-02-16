import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
    TransactionSignature,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { generateOrImportSwapperKeypairs, importLocalKeypair } from "../helpers/account";
import { capitalize, formatDecimal, formatPublicKey } from "../helpers/format";
import {
    getComputeBudgetInstructions,
    sendAndConfirmVersionedTransaction,
} from "../helpers/network";
import { generateRandomFloat } from "../helpers/random";
import { connectionPool, envVars, heliusClientPool, logger, SwapperType } from "../modules";

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

        const sniperAmounts = envVars.SNIPER_SHARE_POOL_PERCENTS.map((sharePoolPercent) =>
            new Decimal(envVars.POOL_LIQUIDITY_SOL)
                .mul(sharePoolPercent)
                .plus(envVars.SWAPPER_BALANCE_SOL)
                .mul(LAMPORTS_PER_SOL)
        );
        const traderAmounts = new Array(envVars.TRADER_COUNT)
            .fill(0)
            .map(() =>
                new Decimal(generateRandomFloat(envVars.TRADER_BUY_AMOUNT_RANGE_SOL))
                    .plus(envVars.SWAPPER_BALANCE_SOL)
                    .mul(LAMPORTS_PER_SOL)
            );

        const sendDistrubuteSniperFundsTransaction = await distributeFunds(
            sniperAmounts,
            distributor,
            snipers,
            SwapperType.Sniper
        );
        const sendDistrubuteTraderFundsTransaction = await distributeFunds(
            traderAmounts,
            distributor,
            traders,
            SwapperType.Trader
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
    accounts: Keypair[],
    swapperType: SwapperType
): Promise<Promise<TransactionSignature | undefined>> {
    let connection = connectionPool.next();
    let heliusClient = heliusClientPool.next();
    const instructions: TransactionInstruction[] = [];
    let fundedAccountCount = 0;

    for (const [i, account] of accounts.entries()) {
        const solBalance = new Decimal(await connection.getBalance(account.publicKey, "confirmed"));

        if (solBalance.gte(lamports[i])) {
            logger.warn(
                "%s (%s) has sufficient balance: %s SOL",
                capitalize(swapperType),
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
            fundedAccountCount++;
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
                "WSOL ATA (%s) exists for %s (%s)",
                wsolTokenAccount.toBase58(),
                swapperType,
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

        connection = connectionPool.next();
        heliusClient = heliusClientPool.next();
    }

    if (instructions.length === 0) {
        return Promise.resolve(undefined);
    }

    const computeBudgetInstructions = await getComputeBudgetInstructions(
        connection,
        heliusClient,
        "Low",
        instructions,
        distributor
    );

    return sendAndConfirmVersionedTransaction(
        connection,
        [...computeBudgetInstructions, ...instructions],
        [distributor],
        `to distribute funds from distributor (${formatPublicKey(distributor.publicKey)}) to ${fundedAccountCount} ${swapperType}s`
    );
}
