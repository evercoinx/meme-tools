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
                .split("")
                .filter((_, index) => index % 2 === 0)
                .reverse()
                .join(""),
            "utf8"
        );
    }

    public encrypt(text: string): string {
        const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, this.iv);

        let encrypted = cipher.update(text, "utf8", "base64");
        encrypted += cipher.final("base64");
        return encrypted;
    }

    public decrypt(encryptedText: string): string {
        const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, this.iv);

        let decrypted = decipher.update(encryptedText, "base64", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }
}
