import fs from "node:fs/promises";
import {
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaPoolId,
    TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT_2022, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import {
    MAX_BPS,
    cluster,
    connection,
    encryption,
    envVars,
    keyring,
    KEYRING_KEY_MINT,
    logger,
} from "./init";
import { loadRaydium } from "../modules/raydium";

(async () => {
    try {
        const [payer, mint] = await importKeypairs();
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

async function createPool(payer: Keypair, mint: Keypair): Promise<void> {
    const raydium = await loadRaydium(cluster, connection, payer);

    let createPoolProgram;
    let createPoolFeeAccount;
    if (cluster === "devnet") {
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
    logger.info(`Pool ${pool.publicKey.toBase58()} computed`);

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
        poolId: pool.publicKey,
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
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mint]);

    logger.info("Transaction confirmed");
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=${cluster}-alpha`);
}
