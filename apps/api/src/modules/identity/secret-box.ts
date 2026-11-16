import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts small secrets (TOTP seeds) before they go into the database, so a
 * database leak alone does not expose them. AES-256-GCM, key from the
 * environment. Format: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("AUTH_SECRET_KEY must be 32 bytes, base64-encoded");
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  open(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("Unknown secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
}
