import { SUPPORTED_LOCALES } from "@hv/contracts";
import { describe, expect, it } from "vitest";
import { createTranslate, MESSAGES } from "./messages";

describe("interface messages", () => {
  it("define the same keys and placeholders in every locale", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(Object.keys(MESSAGES.de).sort());
      for (const [key, text] of Object.entries(MESSAGES[locale])) {
        expect(text.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(placeholders(text), `${locale}:${key}`).toEqual(placeholders(MESSAGES.de[key as keyof typeof MESSAGES.de]));
      }
    }
  });

  it("has a name for every supported language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = createTranslate(locale);
      for (const code of SUPPORTED_LOCALES) expect(t(`language.${code}`).length).toBeGreaterThan(0);
    }
  });
});
