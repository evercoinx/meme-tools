import fs from "node:fs/promises";
import {
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaPoolId,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddress,
    NATIVE_MINT_2022,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
    MAX_BPS,
    connection,
    encryption,
    envVars,
    keyring,
    KEYRING_KEY_MINT,
    logger,
    lamportsToSol,
} from "./init";
import { loadRaydium } from "../modules/raydium";

(async () => {
    try {
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

    const encryptedMint = keyring.get<string>(KEYRING_KEY_MINT);
    if (!encryptedMint) {
        throw new Error(`Mint not loaded from keyring`);
    }

    const mintSecretKey: number[] = JSON.parse(encryption.decrypt(encryptedMint));
    const mint = Keypair.fromSecretKey(Uint8Array.from(mintSecretKey));
    logger.info(`Mint ${mint.publicKey.toBase58()} imported`);

    return [payer, mint];
}

async function wrapSol(amount: number, payer: Keypair): Promise<void> {
    const associatedTokenAccount = await getAssociatedTokenAddress(
        NATIVE_MINT_2022,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const instructions = [];

    const account = await getAccount(
        connection,
        associatedTokenAccount,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
    );
    if (!account.isInitialized) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                associatedTokenAccount,
                payer.publicKey,
                NATIVE_MINT_2022,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            )
        );
    }

    const requestedLamportsToWrap = amount * LAMPORTS_PER_SOL;
    const actualLamportsToWrap = BigInt(requestedLamportsToWrap) - account.amount;
    if (actualLamportsToWrap > 0) {
        const balance = await connection.getBalance(payer.publicKey);
        if (actualLamportsToWrap > balance) {
            throw new Error(`Payer has insufficient balance: ${lamportsToSol(balance)} SOL`);
        }

        instructions.push(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: associatedTokenAccount,
                lamports: actualLamportsToWrap,
            }),
            createSyncNativeInstruction(associatedTokenAccount, TOKEN_2022_PROGRAM_ID)
        );
    }

    if (instructions.length === 0) {
        logger.info(`Payer has sufficient balance: ${lamportsToSol(account.amount)} wSOL`);
        return;
    }

    const transaction = new Transaction().add(...instructions);

    logger.debug(`Sending transaction to wrap ${lamportsToSol(actualLamportsToWrap)} SOL...`);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

    logger.info("Transaction confirmed");
    logger.info(
        `${envVars.EXPLORER_URI}/tx/${signature}?envVars.RPC_CLUSTER=${envVars.RPC_CLUSTER}-alpha`
    );
}

async function createPool(payer: Keypair, mint: Keypair): Promise<void> {
    const raydium = await loadRaydium(envVars.RPC_CLUSTER, connection, payer);

    let createPoolProgram;
    let createPoolFeeAccount;
    if (envVars.RPC_CLUSTER === "devnet") {
        createPoolProgram = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
        createPoolFeeAccount = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;
    } else {
        createPoolProgram = CREATE_CPMM_POOL_PROGRAM;
        createPoolFeeAccount = CREATE_CPMM_POOL_FEE_ACC;
    }

    const feeConfigs = await raydium.api.getCpmmConfigs();
    const feeConfig = feeConfigs[0];

    const mintAPublicKey = mint.publicKey;
    const mintBPublicKey = NATIVE_MINT_2022;

    const pool = getCpmmPdaPoolId(
        createPoolProgram,
        new PublicKey(feeConfig.id),
        mintAPublicKey,
        mintBPublicKey
    );
    logger.info(`Pool id computed: ${pool.publicKey.toBase58()}`);

    const mintA = {
        address: mintAPublicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        decimals: envVars.TOKEN_DECIMALS,
    };
    const mintB = {
        address: mintBPublicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        decimals: 9,
    };
    const mintAAmount = new BN(envVars.TOKEN_SUPPLY)
        .mul(new BN(envVars.TOKEN_DECIMALS))
        .mul(new BN(envVars.TOKEN_POOL_SIZE_BPS))
        .div(new BN(MAX_BPS));

    const mintBAmount = new BN(envVars.TOKEN_POOL_SOL_AMOUNT).mul(new BN(LAMPORTS_PER_SOL));

    const { transaction } = await raydium.cpmm.createPool<TxVersion.LEGACY>({
        programId: createPoolProgram,
        poolFeeAccount: createPoolFeeAccount,
        mintA,
        mintB,
        mintAAmount,
        mintBAmount,
        startTime: new BN(0),
        feeConfig,
        associatedOnly: false,
        ownerInfo: {
            feePayer: payer.publicKey,
            useSOLBalance: true,
        },
    });

    logger.debug("Sending transaction to create pool...");
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

    logger.info("Transaction confirmed");
    logger.info(
        `${envVars.EXPLORER_URI}/tx/${signature}?envVars.RPC_CLUSTER=${envVars.RPC_CLUSTER}-alpha`
    );
}
