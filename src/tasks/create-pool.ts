import fs from "node:fs/promises";
import {
    ApiV3Token,
    CLMM_PROGRAM_ID,
    ClmmConfigInfo,
    DEVNET_PROGRAM_ID,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
    Account,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddress,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import {
    connection,
    encryption,
    envVars,
    storage,
    STORAGE_MINT_SECRET_KEY,
    logger,
    lamportsToSol,
} from "./init";
import { loadRaydium } from "../modules/raydium";

(async () => {
    try {
        if (!["mainnet", "devnet"].includes(envVars.RPC_CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.RPC_CLUSTER}`);
        }

        const [payer, mint] = await importKeypairs();

        await wrapSol(envVars.TOKEN_POOL_SOL_AMOUNT, payer);

        await createPool(payer, mint);
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function importKeypairs(): Promise<[Keypair, Keypair]> {
    const secretKey: number[] = JSON.parse(await fs.readFile(envVars.KEYPAIR_PATH, "utf8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    const balance = await connection.getBalance(payer.publicKey);
    if (balance === 0) {
        await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    }
    logger.info(`Payer ${payer.publicKey.toBase58()} imported`);

    const encryptedMintSecretKey = storage.get<string>(STORAGE_MINT_SECRET_KEY);
    if (!encryptedMintSecretKey) {
        throw new Error("Mint secret key not loaded from storage");
    }

    const mintSecretKey: number[] = JSON.parse(encryption.decrypt(encryptedMintSecretKey));
    const mint = Keypair.fromSecretKey(Uint8Array.from(mintSecretKey));
    logger.info(`Mint ${mint.publicKey.toBase58()} imported`);

    return [payer, mint];
}

async function wrapSol(amount: number, payer: Keypair): Promise<void> {
    const associatedTokenAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        payer.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions = [];
    let account: Account | null = null;
    let actualLamportsHeld = 0n;

    try {
        account = await getAccount(
            connection,
            associatedTokenAccount,
            "confirmed",
            TOKEN_PROGRAM_ID
        );
        actualLamportsHeld = account.amount;
    } catch (err) {
        if (!(err instanceof TokenAccountNotFoundError)) {
            throw err;
        }

        instructions.push(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                associatedTokenAccount,
                payer.publicKey,
                NATIVE_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    const requestedLamportsToWrap = amount * LAMPORTS_PER_SOL;
    const actualLamportsToWrap = BigInt(requestedLamportsToWrap) - actualLamportsHeld;
    if (actualLamportsToWrap > 0) {
        const balance = await connection.getBalance(payer.publicKey);
        if (actualLamportsToWrap > balance) {
            throw new Error(`Owner has insufficient balance: ${lamportsToSol(balance)} SOL`);
        }

        instructions.push(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: associatedTokenAccount,
                lamports: actualLamportsToWrap,
            }),
            createSyncNativeInstruction(associatedTokenAccount, TOKEN_PROGRAM_ID)
        );
    }

    if (instructions.length === 0) {
        logger.info(`Owner has sufficient balance: ${lamportsToSol(actualLamportsHeld)} wSOL`);
        return;
    }

    const transaction = new Transaction().add(...instructions);

    logger.debug(`Sending transaction to wrap ${lamportsToSol(actualLamportsToWrap)} SOL...`);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

    logger.info(`Transaction to wrap ${lamportsToSol(actualLamportsToWrap)} SOL confirmed`);
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=${envVars.RPC_CLUSTER}-alpha`);
}

async function createPool(payer: Keypair, mint: Keypair): Promise<void> {
    const raydium = await loadRaydium(envVars.RPC_CLUSTER, connection, payer);

    const clmmProgramId = raydium.cluster === "devnet" ? DEVNET_PROGRAM_ID.CLMM : CLMM_PROGRAM_ID;
    const clmmConfig: ClmmConfigInfo = {
        id: new PublicKey(
            envVars.RPC_CLUSTER === "devnet"
                ? "GjLEiquek1Nc2YjcBhufUGFRkaqW1JhaGjsdFd8mys38"
                : "A1BBtTYJd4i3xU8D6Tc2FzU6ZN4oXZWXKZnCxwbHXr8x'"
        ),
        index: 3,
        protocolFeeRate: 120_000,
        tradeFeeRate: 10_000,
        tickSpacing: 120,
        fundFeeRate: 40_000,
        fundOwner: "",
        description: "",
    };

    const chainId = raydium.cluster === "devnet" ? 103 : 101;
    const mint1PublicKey = mint.publicKey;
    const mint2PublicKey = NATIVE_MINT;

    const mint1: ApiV3Token = {
        chainId,
        address: mint1PublicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        logoURI: `https://img-v1.raydium.io/icon/${mint1PublicKey.toBase58()}.png`,
        symbol: envVars.TOKEN_SYMBOL,
        name: envVars.TOKEN_SYMBOL,
        decimals: envVars.TOKEN_DECIMALS,
        tags: [],
        extensions: {},
    };
    const mint2: ApiV3Token = {
        chainId,
        address: mint2PublicKey.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
        logoURI: `https://img-v1.raydium.io/icon/${mint2PublicKey.toBase58()}.png`,
        symbol: "WSOL",
        name: "Wrapped SOL",
        decimals: 9,
        tags: [],
        extensions: {},
    };

    const mint1Amount = new Decimal(envVars.TOKEN_SUPPLY)
        .mul(10 ** envVars.TOKEN_DECIMALS)
        .mul(envVars.TOKEN_POOL_SIZE_PERCENT);
    const mint2Amount = new Decimal(envVars.TOKEN_POOL_SOL_AMOUNT).mul(LAMPORTS_PER_SOL);

    const {
        transaction,
        extInfo: {
            address: { id: poolId },
        },
    } = await raydium.clmm.createPool<TxVersion.LEGACY>({
        programId: clmmProgramId,
        owner: payer.publicKey,
        mint1,
        mint2,
        ammConfig: clmmConfig,
        initialPrice: new Decimal(1).div(mint1Amount.div(mint2Amount).toString()),
    });

    logger.debug(`Sending transaction to create pool ${poolId}...`);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

    logger.info(`Transaction to create pool ${poolId} confirmed`);
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=${envVars.RPC_CLUSTER}-alpha`);
}
