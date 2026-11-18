import { SUPPORTED_LOCALES } from "@hv/contracts";
import { describe, expect, it } from "vitest";
import { CATALOGS, createTranslator, renderTemplate, type OperatingCostStatementData, type PaymentReminderData } from "./index.js";

const data: PaymentReminderData = {
  senderName: "Max Sample",
  recipientAddress: ["Erika Sample", "Sample Street 1", "12345 Sampletown"],
  recipientName: "Erika Sample",
  unitLabel: "Ground floor left",
  letterDate: "2025-04-10",
  payUntil: "2025-04-24",
  iban: "DE89 3704 0044 0532 0130 00",
  items: [
    { dueDate: "2025-03-03", description: "Rent March", amountCents: 95_000n },
    { dueDate: "2025-04-03", description: "Rent April", amountCents: 123_456n },
  ],
};

describe("catalogs", () => {
  it("define the same keys and placeholders in every locale", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(CATALOGS[locale]).sort(), locale).toEqual(Object.keys(CATALOGS.de).sort());
      for (const [key, text] of Object.entries(CATALOGS[locale])) {
        expect(text.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(placeholders(text), `${locale}:${key}`).toEqual(placeholders(CATALOGS.de[key as keyof typeof CATALOGS.de]));
      }
    }
  });
});

describe("translator", () => {
  it("formats money and dates per locale", () => {
    const norm = (s: string) => s.replace(/[  ]/g, " ");
    expect(norm(createTranslator("de").money(123_456n))).toBe("1.234,56 €");
    expect(norm(createTranslator("fr").money(123_456n))).toBe("1 234,56 €");
    expect(norm(createTranslator("es").money(-5n))).toBe("-0,05 €");
    expect(createTranslator("de").date("2025-04-10")).toBe("10. April 2025");
    expect(createTranslator("fr").date("2025-04-10")).toBe("10 avril 2025");
    expect(createTranslator("es").date("2025-04-10")).toBe("10 de abril de 2025");
  });

  it("keeps large amounts exact", () => {
    expect(createTranslator("de").money(9_007_199_254_740_993_01n).replace(/ /g, " ")).toBe("9.007.199.254.740.993,01 €");
  });

  it("fails loudly on a missing parameter", () => {
    expect(() => createTranslator("de").t("paymentReminder.salutation")).toThrow(/missing parameter "name"/);
  });
});

describe("payment reminder", () => {
  it("renders in every locale with the total and the language tag", () => {
    const expected = { de: ["Zahlungserinnerung", "2.184,56"], fr: ["Rappel de paiement", "2 184,56"], es: ["Recordatorio de pago", "2184,56"] };
    for (const locale of SUPPORTED_LOCALES) {
      const out = renderTemplate("payment-reminder", locale, data).replace(/[  ]/g, " ");
      expect(out).toContain(`<html lang="${locale}">`);
      expect(out).toContain(`<h1>${expected[locale][0]}</h1>`);
      expect(out, locale).toContain(expected[locale][1]);
      expect(out).not.toMatch(/\{\w+\}/);
    }
  });

  it("escapes user data", () => {
    const out = renderTemplate("payment-reminder", "de", {
      ...data,
      recipientName: `<script>alert("x")</script>`,
      items: [{ dueDate: "2025-04-03", description: "Rent & <b>more</b>", amountCents: 1n }],
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).toContain("Rent &amp; &lt;b&gt;more&lt;/b&gt;");
  });

  it("refuses to render without open items", () => {
    expect(() => renderTemplate("payment-reminder", "de", { ...data, items: [] })).toThrow(RangeError);
  });
});

// Tenancy T2 of apps/api/src/modules/settlement/assemble.test.ts.
const statement: OperatingCostStatementData = {
  senderName: "Max Sample",
  recipientAddress: ["Erika <Sample>", "Linden Street 5", "12345 Sampletown"],
  recipientName: "Erika <Sample>",
  unitLabel: "Linden Street 5, B",
  letterDate: "2027-01-20",
  periodFrom: "2026-01-01",
  periodTo: "2026-12-31",
  days: 184,
  periodDays: 365,
  lines: [
    { category: "insurance", totalCostCents: 100_000n, key: "area", ownWeight: 4000, totalWeight: 10000, shareCents: 20_164n },
    { category: "street_cleaning_waste", totalCostCents: 36_500n, key: "units", ownWeight: 1, totalWeight: 2, shareCents: 9_200n },
    { category: "water_supply", totalCostCents: 73_000n, key: "persons", ownWeight: 184, totalWeight: 1095, shareCents: 12_267n },
  ],
  totalCents: 41_631n,
  advancesPaidCents: 30_000n,
  balanceCents: 11_631n,
  dueDate: "2027-02-15",
};

describe("operating cost statement", () => {
  const render = (locale: "de" | "fr" | "es", data = statement) => renderTemplate("operating-cost-statement", locale, data).replace(/[\u00a0\u202f]/g, " ");

  it("shows total cost, key, share, advances and the balance for every cost", () => {
    const out = render("de");
    expect(out).toContain("<h1>Betriebskostenabrechnung</h1>");
    expect(out).toContain("Sach- und Haftpflichtversicherung");
    expect(out).toContain("1.000,00 €");
    expect(out).toContain("Wohnfläche: 40,00 m² von 100,00 m²");
    expect(out).toContain("Einheiten: 1 von 2");
    expect(out).toContain("Personentage: 184 von 1.095");
    expect(out).toContain("201,64 €");
    expect(out).toContain("416,31 €");
    expect(out).toContain("-300,00 €");
    expect(out).toContain("an 184 von 365 Tagen");
    expect(out).toContain("Bitte überweisen Sie die Nachzahlung von 116,31 € bis zum 15. Februar 2027.");
    expect(out).toContain("Heizung und Warmwasser sind nicht Teil");
  });

  it("escapes names and states a refund", () => {
    const out = render("de", { ...statement, advancesPaidCents: 50_000n, balanceCents: -8_369n, days: 365 });
    expect(out).toContain("Erika &lt;Sample&gt;");
    expect(out).not.toContain("<Sample>");
    expect(out).toContain("Ihr Guthaben von 83,69 € erstatten wir Ihnen.");
    expect(out).not.toContain("Tagen; Ihr Anteil");
  });

  it("renders in every locale without open placeholders", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const out = render(locale);
      expect(out).toContain(`<html lang="${locale}">`);
      expect(out, locale).not.toMatch(/\{\w+\}/);
    }
  });
});
