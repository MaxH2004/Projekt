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
const previousMonth = (() => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();

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
const receiptFile = join(dir, "Rechnung Versicherung.pdf");
await writeFile(receiptFile, "%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

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
    await form.getByLabel("Fläche gilt seit").fill("2000-01-01");
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
  await page.getByLabel("Beleg", { exact: true }).setInputFiles(receiptFile);
  await submit(page, "Speichern");
  await page.getByText("Versicherung Beispiel AG").waitFor();
  // The receipt is attached and comes back unchanged as a download.
  const row = page.locator("tr", { hasText: "Versicherung Beispiel AG" });
  await row.getByText("Belege (1)").click();
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Rechnung Versicherung.pdf" }).click()]);
  assert.equal(download.suggestedFilename(), "Rechnung Versicherung.pdf");

  // A contract on the property page.
  await page.goto(`${base}/properties`);
  await page.getByRole("link", { name: "Lindenstraße 5" }).click();
  const documents = page.locator("section", { hasText: "Dokumente" });
  await documents.getByLabel("Datei").setInputFiles(receiptFile);
  await documents.getByLabel("Art").selectOption("contract");
  await submit(documents, "Hochladen");
  await documents.getByRole("link", { name: "Rechnung Versicherung.pdf" }).waitFor();
  assert.match(await documents.innerText(), /Vertrag/);

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

  // Operating cost settlement for the current month, by area. EG 54.37 m² (let all month),
  // OG 61.20 m² (vacant); total 115.57 m².
  //   Insurance 312.50 × 5437/11557 = 147.019… → 147.02 (remainder 6793 beats 4764 of OG)
  //   Waste 119.00 × 5437/11557 = 55.983… → 55.98 (the cent goes to OG, remainder 7343 beats 4214)
  //   Share 203.00, advance paid 150.00 → 53.00 to pay.
  await page.goto(`${base}/settlements`);
  await page.getByLabel("Von (Monat)").fill(month);
  await page.getByLabel("Bis (Monat)").fill(month);
  await page.getByRole("button", { name: "Vorbereiten" }).click();
  await page.waitForURL(/\/settlements\/new/);
  await page.getByText("Heiz- und Warmwasserkosten").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Berechnen" }).click();
  await page.waitForURL(/preview=1/);
  await page.getByRole("cell", { name: "53,00 € Nachzahlung" }).waitFor();
  await page.getByLabel("Nachzahlungen fällig am").fill(`${year + 1}-01-31`);
  await submit(page, "Abrechnung festschreiben");
  await page.waitForURL(/\/settlements\/[0-9a-f-]{36}$/);
  const statementHref = await page.getByRole("link", { name: "Abrechnung öffnen" }).getAttribute("href");
  const doc = await browser.newPage();
  await doc.context().addCookies(await page.context().cookies());
  await doc.goto(`${base}${statementHref}`);
  const letter = (await doc.locator("body").innerText()).replace(/[\u00a0\u202f]/g, " ");
  assert.match(letter, /Betriebskostenabrechnung/);
  assert.match(letter, /Wohnfläche: 54,37 m² von 115,57 m²/);
  assert.match(letter, /147,02 €/);
  assert.match(letter, /55,98 €/);
  assert.match(letter, /Bitte überweisen Sie die Nachzahlung von 53,00 €/);
  await doc.close();
  await page.goto(`${base}/rent`);
  await page.getByRole("cell", { name: "Nachzahlung Betriebskosten" }).waitFor();

  // Bank details: a wrong check digit is refused, the right IBAN is stored.
  await page.goto(`${base}/account`);
  const details = page.locator("section", { hasText: "Absender und Bankverbindung" });
  await details.getByLabel("Straße und Hausnummer").fill("Eichenweg 1");
  await details.getByLabel("PLZ").fill("12345");
  await details.getByLabel("Ort", { exact: true }).fill("Musterstadt");
  await details.getByLabel("IBAN").fill("DE89 3704 0044 0532 0130 01");
  await submit(details, "Speichern");
  await details.locator(".form-error").getByText("Bitte prüfen Sie die markierten Eingaben.").waitFor();
  assert.equal(await details.getByLabel("IBAN").getAttribute("aria-invalid"), "true");
  await details.getByLabel("IBAN").fill("DE89 3704 0044 0532 0130 00");
  await submit(details, "Speichern");
  await details.locator(".form-error").waitFor({ state: "detached" });

  // An unpaid previous month makes a reminder possible: 700.00 + 150.00 overdue.
  await page.goto(`${base}/rent`);
  await page.getByLabel("Monat").fill(previousMonth);
  await submit(page, "Forderungen erzeugen");
  await page.goto(`${base}/tenancies`);
  await page.getByRole("link", { name: /EG links · Erika Müller/ }).click();
  await page.waitForURL(/\/tenancies\/.+/);
  await page.getByText("2 überfällige Forderungen, zusammen 850,00 €.").waitFor();
  await page.getByLabel("Zahlen bis").fill(`${year + 1}-01-15`);
  const [reminder] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Erinnerung öffnen" }).click()]);
  await reminder.waitForLoadState();
  const reminderText = (await reminder.locator("body").innerText()).replace(/[\u00a0\u202f]/g, " ");
  assert.match(reminderText, /Musterverwaltung · Eichenweg 1 · 12345 Musterstadt/);
  assert.match(reminderText, /Zahlungserinnerung/);
  assert.match(reminderText, /Nettokaltmiete/);
  assert.match(reminderText, /Offener Gesamtbetrag\s+850,00 €/);
  assert.match(reminderText, new RegExp(`bis zum 15\\. Januar ${year + 1} auf das Konto DE89 3704 0044 0532 0130 00`));
  await reminder.close();

  // Every booking above is in the audit log, attributed to the user.
  await page.goto(`${base}/account/audit`);
  await page.getByRole("cell", { name: "Ausgabe · angelegt" }).first().waitFor();
  await page.getByRole("cell", { name: "Zahlung · angelegt" }).first().waitFor();
  await page.getByRole("cell", { name: "Abrechnung · angelegt" }).first().waitFor();
  await page.goBack();

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
