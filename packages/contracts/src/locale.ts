/**
 * Languages the product is offered in. Adding one means: add it here, then
 * the compiler points at every message catalog that is missing it.
 */
export const SUPPORTED_LOCALES = ["de", "fr", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";

/** BCP 47 tags used for number, currency and date formatting. */
export const FORMAT_LOCALE: Record<Locale, string> = { de: "de-DE", fr: "fr-FR", es: "es-ES" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an Accept-Language header, honouring
 * quality values. Falls back to the default locale.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { language: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of ranked) {
    if (isLocale(entry.language)) return entry.language;
  }
  return DEFAULT_LOCALE;
}
