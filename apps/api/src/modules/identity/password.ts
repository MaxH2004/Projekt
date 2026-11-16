import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt cost parameters. Stored with every hash, so they can be raised later
// without invalidating existing passwords.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns `scrypt$N$r$p$salt$hash` with salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), { ...cost, maxmem: 128 * cost.N * cost.r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A valid hash of a random password. Verifying against it takes as long as a
 * real check, so a login for an unknown e-mail is not answered faster.
 */
export const DUMMY_HASH: Promise<string> = hashPassword(randomBytes(32).toString("base64url"));
