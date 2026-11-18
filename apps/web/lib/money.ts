import { FORMAT_LOCALE, type Locale } from "@hv/contracts";

/**
 * Reads an amount in euro as typed by a user and returns cents, or null if
 * it is not an amount. A comma is the decimal separator; dots before it group
 * thousands. Without a comma, a dot followed by one or two digits is taken as
 * the decimal separator ("850.5"), otherwise as grouping ("1.000").
 */
export function parseMoney(input: string): number | null {
  let text = input.replace(/[\s  €]/g, "");
  if (text === "") return null;
  if (text.includes(",")) {
    if (text.indexOf(",") !== text.lastIndexOf(",")) return null;
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(text) && !/^\d+(,\d{1,2})?$/.test(text)) return null;
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(text)) {
    // decimal point
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  } else if (!/^\d+$/.test(text)) {
    return null;
  }
  const [whole = "0", fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatMoney(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(FORMAT_LOCALE[locale], { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Cents as the user would type them, for prefilled inputs: 85000 → "850,00". */
export function moneyInput(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(FORMAT_LOCALE[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);
}

/** A calendar date YYYY-MM-DD in the user's format. */
export function formatDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(FORMAT_LOCALE[locale], { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** A month YYYY-MM in the user's format. */
export function formatMonth(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(FORMAT_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Area in hundredths of a square metre, e.g. 5437 → "54,37 m²". */
export function formatArea(centiSqm: number, locale: Locale): string {
  return `${new Intl.NumberFormat(FORMAT_LOCALE[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centiSqm / 100)} m²`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
