// End-to-end run through the interface: registration, master data, rent
// charges, bank import with booking, an expense, the report, language switch,
// phone width and logout.
//
// Needs a running API and web app, and Playwright with Chromium, installed in
// the project or globally (then set NODE_PATH). Not part of `pnpm verify` yet,
// see docs/BACKLOG.md.
//
//   BASE_URL=http://127.0.0.1:3000 NODE_PATH=$(npm root -g) node tests/e2e/main-flow.mjs
//
// All data is invented; the IBANs are published sample numbers.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// require() honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const year = new Date().getUTCFullYear();
const month = new Date().toISOString().slice(0, 7);

const statement = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
  <GrpHdr><MsgId>M</MsgId><CreDtTm>${month}-10T08:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>S</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
    <Ntry><Amt Ccy="EUR">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${month}-03</Dt></BookgDt><AcctSvcrRef>A1</AcctSvcrRef>
      <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>ERIKA MUELLER</Nm></Dbtr><DbtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></DbtrAcct></RltdPties>
      <RmtInf><Ustrd>Miete EG links</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
    <Ntry><Amt Ccy="EUR">119.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${month}-05</Dt></BookgDt><AcctSvcrRef>A2</AcctSvcrRef>
      <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Entsorgung Beispiel GmbH</Nm></Cdtr><CdtrAcct><Id><IBAN>DE75512108001245126199</IBAN></Id></CdtrAcct></RltdPties>
      <RmtInf><Ustrd>Muellgebuehren</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  </Stmt>
</BkToCstmrStmt></Document>`;

const dir = await mkdtemp(join(tmpdir(), "hv-e2e-"));
const statementFile = join(dir, "statement.xml");
await writeFile(statementFile, statement);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "de-DE" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const submit = async (scope, label) => {
  await scope.getByRole("button", { name: label }).click();
  await page.waitForLoadState("networkidle");
};

try {
  await page.goto(`${base}/register`);
  await page.getByLabel("Name Ihrer Verwaltung").fill("Musterverwaltung");
  await page.getByLabel("E-Mail-Adresse").fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel("Passwort").fill("ein langes Passwort 123");
  await submit(page, "Konto anlegen");
  await page.waitForURL(`${base}/`);

  await page.goto(`${base}/properties`);
  await page.getByLabel("Name", { exact: true }).fill("Lindenstraße 5");
  await submit(page, "Anlegen");
  await page.waitForURL(/\/properties\/.+/);
  await page.getByLabel("Straße und Hausnummer").fill("Lindenstraße 5");
  await page.getByLabel("PLZ").fill("12345");
  await page.getByLabel("Ort").fill("Musterstadt");
  await submit(page, "Anlegen");
  for (const [label, area] of [["EG links", "54,37"], ["OG rechts", "61,2"]]) {
    if ((await page.locator("details[open] form").count()) === 0) await page.getByText("Einheit hinzufügen").click();
    const form = page.locator("details[open] form");
    await form.getByLabel("Bezeichnung").fill(label);
    await form.getByLabel("Wohnfläche in m²").fill(area);
    await submit(form, "Anlegen");
    await page.getByRole("cell", { name: label }).waitFor();
  }
  await page.getByRole("cell", { name: "54,37 m²" }).waitFor();

  await page.goto(`${base}/persons`);
  for (const [given, family] of [["Erika", "Müller"], ["Max", "Beispiel"]]) {
    await page.getByLabel("Vorname").fill(given);
    await page.getByLabel("Nachname").fill(family);
    await submit(page, "Anlegen");
    await page.getByRole("cell", { name: `${given} ${family}` }).waitFor();
  }

  await page.goto(`${base}/tenancies`);
  await page.getByLabel("Einheit").selectOption({ label: "Lindenstraße 5 · EG links" });
  await page.getByLabel("Beginn").fill(`${year}-01-01`);
  await page.getByLabel("Nettokaltmiete").fill("700");
  await page.getByLabel("Vorauszahlung Betriebskosten").fill("150,00");
  await page.getByLabel("Erika Müller").check();
  await submit(page, "Anlegen");
  await page.waitForURL(/\/tenancies\/.+/);

  // Invalid input is marked and kept; an overlapping tenancy is refused.
  await page.goto(`${base}/tenancies`);
  await page.getByLabel("Einheit").selectOption({ label: "Lindenstraße 5 · EG links" });
  await page.getByLabel("Beginn").fill(`${year}-06-01`);
  await page.getByLabel("Nettokaltmiete").fill("abc");
  await page.getByLabel("Max Beispiel").check();
  await submit(page, "Anlegen");
  await page.locator(".form-error").getByText("Bitte prüfen Sie die markierten Eingaben.").waitFor();
  assert.equal(await page.getByLabel("Nettokaltmiete").getAttribute("aria-invalid"), "true");
  assert.equal(await page.getByLabel("Nettokaltmiete").inputValue(), "abc");
  await page.getByLabel("Nettokaltmiete").fill("500");
  await submit(page, "Anlegen");
  await page.getByText("Das passt nicht zu bereits vorhandenen Daten").waitFor();

  await page.goto(`${base}/rent`);
  await page.getByLabel("Monat").fill(month);
  await submit(page, "Forderungen erzeugen");
  await page.getByRole("cell", { name: "Nettokaltmiete" }).waitFor();

  await page.goto(`${base}/bank`);
  await page.getByLabel("Kontoauszug (CAMT.053, XML)").setInputFiles(statementFile);
  await submit(page, "Einlesen");
  const incoming = page.locator("li.transaction", { hasText: "ERIKA MUELLER" });
  const suggested = await incoming.getByLabel("Mietverhältnis").evaluate((s) => s.options[s.selectedIndex].text);
  assert.equal(suggested, "Lindenstraße 5 · EG links · Erika Müller (Betrag passt, Name passt)");
  await submit(incoming, "Als Mietzahlung buchen");
  await page.getByText("ERIKA MUELLER").waitFor({ state: "detached" });
  const outgoing = page.locator("li.transaction", { hasText: "Entsorgung" });
  await outgoing.getByLabel("Konto", { exact: true }).selectOption("685900");
  await outgoing.getByLabel("Betriebskostenart").selectOption("street_cleaning_waste");
  await submit(outgoing, "Als Ausgabe buchen");
  await page.getByText("Alle Umsätze sind gebucht.").waitFor();

  await page.goto(`${base}/expenses`);
  await page.getByLabel("Bezahlt am").fill(`${month}-10`);
  await page.getByLabel("Betrag").fill("312,50");
  await page.getByLabel("Bezahlt von").selectOption("private");
  await page.getByLabel("Konto", { exact: true }).selectOption("640000");
  await page.getByLabel("Betriebskostenart").selectOption("insurance");
  await page.getByLabel("Empfänger").fill("Versicherung Beispiel AG");
  await submit(page, "Speichern");
  await page.getByText("Versicherung Beispiel AG").waitFor();

  // 850.00 rent and advance; 119.00 waste and 312.50 insurance; result 418.50.
  await page.goto(`${base}/reports?year=${year}`);
  const totals = (await page.locator("tfoot").first().innerText()).replace(/\s+/g, " ");
  assert.match(totals, /Einnahmen 850,00 €/);
  assert.match(totals, /Ergebnis 418,50 €/);

  await page.goto(`${base}/tenancies`);
  await page.getByRole("link", { name: /EG links · Erika Müller/ }).click();
  await page.waitForURL(/\/tenancies\/.+/);
  const balance = (await page.locator(".stats").innerText()).replace(/\s+/g, " ");
  assert.match(balance, /850,00 € Gefordert 850,00 € Bezahlt 0,00 € Offen/);

  await page.getByRole("combobox", { name: "Sprache" }).selectOption("fr");
  await submit(page, "Übernehmen");
  await page.getByRole("link", { name: "Aperçu" }).waitFor();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.context().addCookies(await page.context().cookies());
  for (const path of ["/", "/bank", "/expenses", "/tenancies"]) {
    await phone.goto(`${base}${path}`);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `horizontal scroll on ${path}`);
  }

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(`${base}/login`);
  await page.goto(`${base}/bank`);
  await page.waitForURL(`${base}/login`);

  assert.deepEqual(errors, []);
  console.log("main flow passed");
} finally {
  await browser.close();
}
