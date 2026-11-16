import { describe, expect, it } from "vitest";
import { isLocale, negotiateLocale } from "./index.js";

describe("negotiateLocale", () => {
  it("picks the first supported language", () => {
    expect(negotiateLocale("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7")).toBe("fr");
    expect(negotiateLocale("en-US,en;q=0.9,es;q=0.8")).toBe("es");
  });

  it("honours quality values over order", () => {
    expect(negotiateLocale("fr;q=0.5, es;q=0.9")).toBe("es");
    expect(negotiateLocale("es;q=0, fr")).toBe("fr");
  });

  it("falls back to German", () => {
    expect(negotiateLocale(undefined)).toBe("de");
    expect(negotiateLocale("")).toBe("de");
    expect(negotiateLocale("en-US, ja")).toBe("de");
    expect(negotiateLocale("*")).toBe("de");
  });
});

describe("isLocale", () => {
  it("accepts only supported locales", () => {
    expect(["de", "fr", "es"].every(isLocale)).toBe(true);
    expect([undefined, "en", "DE", "de-DE", 1].some(isLocale)).toBe(false);
  });
});
