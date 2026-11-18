import { FORMAT_LOCALE, type Locale } from "@hv/contracts";
import { de, type Catalog, type MessageKey } from "./locales/de.js";
import { es } from "./locales/es.js";
import { fr } from "./locales/fr.js";

export const CATALOGS: Record<Locale, Catalog> = { de, fr, es };

/** Everything a template needs to produce text in one language. */
export interface Translator {
  readonly locale: Locale;
  /** Translated message with placeholders filled. The result is plain text, not HTML. */
  t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string;
  money(cents: bigint): string;
  /** A number with a fixed count of decimals, e.g. an area. */
  decimal(value: number, digits: number): string;
  date(isoDate: string): string;
}

export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];
  const tag = FORMAT_LOCALE[locale];
  const currency = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  const dateFormat = new Intl.DateTimeFormat(tag, { dateStyle: "long", timeZone: "UTC" });

  return {
    locale,
    t(key, params = {}) {
      return catalog[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        const value = params[name];
        if (value === undefined) throw new Error(`Message "${key}" is missing parameter "${name}"`);
        return String(value);
      });
    },
    money(cents) {
      // Intl accepts a decimal string, which keeps large amounts exact.
      const negative = cents < 0n;
      const abs = negative ? -cents : cents;
      const decimal = `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
      return currency.format(decimal as unknown as number);
    },
    decimal(value, digits) {
      return new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    },
    date(isoDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`Invalid date: ${isoDate}`);
      return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
    },
  };
}
