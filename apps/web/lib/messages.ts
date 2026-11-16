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
