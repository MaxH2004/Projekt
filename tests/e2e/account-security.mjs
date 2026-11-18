// End-to-end run through account security: two-factor setup with recovery
// codes, login with a recovery code, password change, switching two-factor
// off, and the security headers of the pages. Same requirements as
// main-flow.mjs.
//
//   BASE_URL=http://127.0.0.1:3000 NODE_PATH=$(npm root -g) node tests/e2e/account-security.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";

/** RFC 6238 code for a base32 secret, as an authenticator app computes it. */
function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/\s+/g, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const browser = await chromium.launch();
const page = await browser.newPage({ locale: "de-DE" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const email = `security-${Date.now()}@example.com`;
let password = "ein langes Passwort 123";
const submit = async (scope, label) => {
  await scope.getByRole("button", { name: label }).click();
  await page.waitForLoadState("networkidle");
};
const loginWith = async (pw, code) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(pw);
  if (code) await page.getByLabel(/Code aus der Authenticator-App/).fill(code);
  await submit(page, "Anmelden");
};

try {
  const headers = (await page.goto(`${base}/login`)).headers();
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(headers["x-powered-by"], undefined);

  await page.goto(`${base}/register`);
  await page.getByLabel("Name Ihrer Verwaltung").fill("Sicherheit");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await submit(page, "Konto anlegen");
  await page.waitForURL(`${base}/`);

  // Two-factor setup: the codes are shown once, until confirmed.
  await page.goto(`${base}/account`);
  await page.getByRole("button", { name: "Einrichten" }).click();
  await page.locator(".qr svg").waitFor();
  const secret = (await page.locator("code.secret").first().innerText()).replace(/\s+/g, "");
  await page.getByLabel("Code aus der Authenticator-App oder Wiederherstellungscode").fill(totp(secret));
  await submit(page, "Aktivieren");
  await page.getByText("Ihre Wiederherstellungscodes").waitFor();
  const codes = await page.locator("ul.codes code").allInnerTexts();
  assert.equal(codes.length, 10);
  await page.getByRole("button", { name: "Ich habe die Codes notiert" }).click();
  await page.getByText("Ihre Wiederherstellungscodes").waitFor({ state: "detached" });

  // Login needs the second factor; a recovery code works once.
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(`${base}/login`);
  await loginWith(password);
  await page.getByText("Bitte geben Sie den Code aus Ihrer Authenticator-App ein.").waitFor();
  await loginWith(password, codes[0]);
  await page.waitForURL(`${base}/`);

  // Password change.
  await page.goto(`${base}/account`);
  const passwordForm = page.locator("section", { hasText: "Passwort ändern" });
  await passwordForm.getByLabel("Aktuelles Passwort").fill("falsches Passwort 123");
  await passwordForm.getByLabel("Neues Passwort").fill("ein anderes langes Passwort");
  await submit(passwordForm, "Speichern");
  await passwordForm.getByText("E-Mail-Adresse oder Passwort ist falsch.").waitFor();
  await passwordForm.getByLabel("Aktuelles Passwort").fill(password);
  await passwordForm.getByLabel("Neues Passwort").fill("ein anderes langes Passwort");
  await submit(passwordForm, "Speichern");
  await passwordForm.getByText("Passwort geändert.").waitFor();
  password = "ein anderes langes Passwort";

  // Switching two-factor off with password and a recovery code.
  await page.getByText("Zwei-Faktor-Anmeldung ausschalten").first().click();
  const disable = page.locator("details[open]", { hasText: "Zwei-Faktor-Anmeldung ausschalten" });
  await disable.getByLabel("Passwort", { exact: true }).fill(password);
  await disable.getByLabel("Code aus der App oder Wiederherstellungscode").fill(codes[1]);
  await submit(disable, "Zwei-Faktor-Anmeldung ausschalten");
  await page.getByRole("button", { name: "Einrichten" }).waitFor();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(`${base}/login`);
  await loginWith(password);
  await page.waitForURL(`${base}/`);

  assert.deepEqual(errors, []);
  console.log("account security passed");
} finally {
  await browser.close();
}
