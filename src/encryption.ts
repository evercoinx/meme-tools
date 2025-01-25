import crypto from "node:crypto";

export class Encryption {
    private readonly algorithm;
    private readonly secretKey;
    private readonly iv;

    constructor(algorithm: string, secretKey: string) {
        this.algorithm = algorithm;
        this.secretKey = secretKey;
        this.iv = Buffer.from(
            secretKey
                .slice(secretKey.length / 2)
                .split("")
                .reverse()
                .join(""),
            "utf-8"
        );
    }

    public encrypt(text: string): string {
        const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, this.iv);

        let encrypted = cipher.update(text, "utf-8", "base64");
        encrypted += cipher.final("base64");
        return encrypted;
    }

    public decrypt(encryptedText: string): string {
        const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, this.iv);

        let decrypted = decipher.update(encryptedText, "base64", "utf-8");
        decrypted += decipher.final("utf-8");
        return decrypted;
    }
}
