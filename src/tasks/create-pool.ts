import fs from "node:fs/promises";
import path from "node:path";
import {
    ApiV3Token,
    CREATE_CPMM_POOL_FEE_ACC,
    CREATE_CPMM_POOL_PROGRAM,
    DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    Raydium,
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
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
    connection,
    encryption,
    envVars,
    logger,
    storage,
    STORAGE_DIR,
    STORAGE_MINT_SECRET_KEY,
    STORAGE_RAYDIUM_POOL_ID,
} from "./init";
import { loadRaydium } from "../modules/raydium";
import { checkIfFileExists, lamportsToSol } from "./helpers";

type Token = Pick<ApiV3Token, "address" | "programId" | "symbol" | "name" | "decimals">;

(async () => {
    try {
        if (!["mainnet", "devnet"].includes(envVars.RPC_CLUSTER)) {
            throw new Error(`Unsupported cluster for Raydium: ${envVars.RPC_CLUSTER}`);
        }

        const storageExists = await checkIfFileExists(path.join(STORAGE_DIR, storage.cacheId));
        if (!storageExists) {
            throw new Error(`Storage ${storage.cacheId} not exists`);
        }

        const [payer, mint] = await importKeypairs();
        await wrapSol(envVars.TOKEN_POOL_SOL_AMOUNT, payer);

        const raydium = await loadRaydium(envVars.RPC_CLUSTER, connection, payer);
        await createPool(raydium, payer, mint);
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

async function createPool(raydium: Raydium, payer: Keypair, mint: Keypair): Promise<string> {
    let raydiumPoolId = storage.get<string>(STORAGE_RAYDIUM_POOL_ID);
    if (raydiumPoolId) {
        logger.info(`Raydium pool id ${raydiumPoolId} loaded from storage`);
        return raydiumPoolId;
    }

    const mintA: Token = {
        address: NATIVE_MINT.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
        symbol: "WSOL",
        name: "Wrapped SOL",
        decimals: 9,
    };
    const mintB: Token = {
        address: mint.publicKey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        symbol: envVars.TOKEN_SYMBOL,
        name: envVars.TOKEN_SYMBOL,
        decimals: envVars.TOKEN_DECIMALS,
    };

    const feeConfigs = await raydium.api.getCpmmConfigs();
    if (raydium.cluster === "devnet") {
        feeConfigs.forEach((feeConfig) => {
            const id = getCpmmPdaAmmConfigId(
                DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
                feeConfig.index
            );
            feeConfig.id = id.publicKey.toBase58();
        });
    }
    const feeConfig = feeConfigs[0];

    const {
        transaction,
        extInfo: {
            address: { poolId },
        },
    } = await raydium.cpmm.createPool<TxVersion.LEGACY>({
        programId:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
                : CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount:
            raydium.cluster === "devnet"
                ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
                : CREATE_CPMM_POOL_FEE_ACC,
        mintA,
        mintB,
        mintAAmount: new BN(
            new Decimal(envVars.TOKEN_POOL_SOL_AMOUNT).mul(LAMPORTS_PER_SOL).toFixed(0)
        ),
        mintBAmount: new BN(
            new Decimal(envVars.TOKEN_SUPPLY)
                .mul(10 ** envVars.TOKEN_DECIMALS)
                .mul(envVars.TOKEN_POOL_SIZE_PERCENT)
                .toFixed(0)
        ),
        startTime: new BN(0),
        feeConfig,
        associatedOnly: false,
        ownerInfo: {
            useSOLBalance: false,
        },
    });

    raydiumPoolId = poolId.toBase58();
    logger.debug(`Sending transaction to create pool ${raydiumPoolId}...`);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

    logger.info(`Transaction to create pool ${raydiumPoolId} confirmed`);
    logger.info(`${envVars.EXPLORER_URI}/tx/${signature}?cluster=${envVars.RPC_CLUSTER}-alpha`);
    logger.info(
        `${envVars.EXPLORER_URI}/address/${raydiumPoolId}?cluster=${envVars.RPC_CLUSTER}-alpha`
    );

    storage.set(STORAGE_RAYDIUM_POOL_ID, raydiumPoolId);
    storage.save();
    logger.debug(`Raydium pool id ${raydiumPoolId} saved to storage`);

    return raydiumPoolId;
}
