import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
import { SecretBox } from "./secret-box.js";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, timeStep, totpCode, verifyTotp } from "./totp.js";

describe("TOTP", () => {
  // RFC 6238 appendix B, SHA-1 rows; the six-digit code is the tail of the eight-digit one.
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 6238 test vectors", () => {
    expect(totpCode(rfcSecret, timeStep(59_000))).toBe("287082");
    expect(totpCode(rfcSecret, timeStep(1_111_111_109_000))).toBe("081804");
    expect(totpCode(rfcSecret, timeStep(1_234_567_890_000))).toBe("005924");
    expect(totpCode(rfcSecret, timeStep(20_000_000_000_000))).toBe("353130");
  });

  it("round-trips base32, as in RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
    expect(() => base32Decode("not base32!")).toThrow(RangeError);
  });

  it("accepts the neighbouring steps but nothing further away", () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step), now, null)).toBe(step);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(rfcSecret, "12345", now, null)).toBeNull();
  });

  it("refuses a code from a step that was already used", () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step), now, step)).toBeNull();
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 1), now, step)).toBeNull();
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step + 1), now, step)).toBe(step + 1);
  });

  it("builds an otpauth URI with escaped label", () => {
    expect(otpauthUri("ABC", "a b@example.com", "My App")).toBe(
      "otpauth://totp/My%20App:a%20b%40example.com?secret=ABC&issuer=My%20App&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterx", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password 123")).not.toBe(await hashPassword("same password 123"));
  });
});

describe("SecretBox", () => {
  const box = new SecretBox(randomBytes(32).toString("base64"));

  it("round-trips and never repeats a ciphertext", () => {
    const sealed = box.seal("JBSWY3DPEHPK3PXP");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(box.open(sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(box.seal("JBSWY3DPEHPK3PXP")).not.toBe(sealed);
  });

  it("rejects tampered data, a wrong key and a short key", () => {
    const sealed = box.seal("secret");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other!").toString("base64url");
    expect(() => box.open(parts.join("."))).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString("base64")).open(sealed)).toThrow();
    expect(() => new SecretBox(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
