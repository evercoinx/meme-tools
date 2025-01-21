import { readFile } from "node:fs/promises";
import {
    MINT_SIZE,
    TOKEN_2022_PROGRAM_ID,
    createInitializeMintInstruction,
    getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import { extractEnvironmentVariables } from "./environment";

const isCI = !!process.env.CI;
dotenv.config({
    path: isCI ? ".env.example" : ".env",
});

const envVars = extractEnvironmentVariables();

(async () => {
    const keypairDeployerContents = await readFile(envVars.KEYPAIR_PATH, "utf-8");
    const devSecretKey = Uint8Array.from(JSON.parse(keypairDeployerContents));
    const devKeypair = Keypair.fromSecretKey(devSecretKey);
    console.log("Dev address imported:", devKeypair.publicKey.toBase58());

    const mintKeypair = Keypair.generate();
    console.log("Mint address created:", mintKeypair.publicKey.toBase58());

    const connection = new Connection(envVars.RPC_URL, "confirmed");
    const mintRent = await getMinimumBalanceForRentExemptMint(connection);

    const transaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: devKeypair.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: mintRent,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            9,
            devKeypair.publicKey,
            null,
            TOKEN_2022_PROGRAM_ID
        )
    );

    await sendAndConfirmTransaction(connection, transaction, [devKeypair, mintKeypair]);
})();
