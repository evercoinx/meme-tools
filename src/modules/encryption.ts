import crypto from "node:crypto";

export class Encryption {
    private readonly algorithm;
    private readonly secretKey;
    private readonly prefix;
    private readonly iv;

    constructor(algorithm: string, secretKey: string, prefix: string) {
        this.algorithm = algorithm;
        this.secretKey = secretKey;
        this.prefix = `${prefix}:`;
        this.iv = Buffer.from(
            secretKey
                .split("")
                .filter((_, index) => index % 2 === 0)
                .reverse()
                .join(""),
            "utf8"
        );
    }

    public encrypt(data: Uint8Array): string {
        const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, this.iv);

        const hexData = Buffer.from(data).toString("hex");
        let encrypted = cipher.update(hexData, "utf8", "base64");
        encrypted += cipher.final("base64");

        return `${this.prefix}${encrypted}`;
    }

    public decrypt(text: string): Uint8Array {
        if (!text.startsWith(this.prefix)) {
            throw new Error(`Text has not prefix: ${this.prefix}`);
        }

        const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, this.iv);

        const unprefixedText = text.replace(this.prefix, "");
        let decrypted = decipher.update(unprefixedText, "base64", "utf8");
        decrypted += decipher.final("utf8");

        return new Uint8Array(Buffer.from(decrypted, "hex"));
    }
}
