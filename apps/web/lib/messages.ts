import type { Locale } from "@hv/contracts";
import de from "../messages/de.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";

/** German is the reference catalog; a test keeps the others in step with it. */
export type MessageKey = keyof typeof de;
export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { de, fr, es };

export type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

export function createTranslate(locale: Locale): Translate {
  const catalog = MESSAGES[locale];
  return (key, params = {}) =>
    catalog[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`Message "${key}" is missing parameter "${name}"`);
      return String(value);
    });
}

/** For keys built at run time from data (e.g. account numbers): true if the catalog has the key. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(de, key);
}

/** Name of an account of the chart in the user's language; the stored name if none is translated. */
export function accountName(t: Translate, account: { code: string; name: string }): string {
  const key = `account.${account.code}`;
  return isMessageKey(key) ? t(key) : account.name;
}
