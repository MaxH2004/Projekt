import { describe, expect, it } from "vitest";
import { formatIban, isValidIban, organizationDetailsSchema } from "./organization.js";

// Published sample IBANs, no real accounts.
describe("IBAN", () => {
  it("accepts valid IBANs with or without spaces", () => {
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE02120300000000202051")).toBe(true);
    expect(isValidIban("FR1420041010050500013M02606")).toBe(true);
  });

  it("refuses wrong check digits, lengths and characters", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("DE8937040044053201300")).toBe(false);
    expect(isValidIban("DE89-3704-0044-0532-0130-00")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });

  it("is printed in groups of four", () => {
    expect(formatIban("DE89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });
});

describe("organization details", () => {
  it("normalizes the IBAN and turns empty fields into null", () => {
    expect(organizationDetailsSchema.parse({ street: " ", city: "Sampletown", iban: "de89 3704 0044 0532 0130 00" })).toEqual({
      street: null,
      city: "Sampletown",
      iban: "DE89370400440532013000",
    });
    expect(organizationDetailsSchema.parse({ iban: "" }).iban).toBeNull();
    expect(organizationDetailsSchema.safeParse({ iban: "DE00 0000" }).success).toBe(false);
  });
});
