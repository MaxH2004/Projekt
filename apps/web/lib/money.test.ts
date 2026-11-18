import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney } from "./money";

describe("parseMoney", () => {
  it("reads the ways people type euro amounts", () => {
    expect(parseMoney("850")).toBe(85000);
    expect(parseMoney("850,5")).toBe(85050);
    expect(parseMoney("850,50 €")).toBe(85050);
    expect(parseMoney("1.250,00")).toBe(125000);
    expect(parseMoney("1 250,00")).toBe(125000);
    expect(parseMoney("850.50")).toBe(85050);
    expect(parseMoney("1.000")).toBe(100000);
    expect(parseMoney("0,01")).toBe(1);
  });

  it("refuses what is not an amount", () => {
    for (const input of ["", "abc", "1,2,3", "8,505", "-5", "1.00.0", "12.3456", "1,000.00"]) expect(parseMoney(input), input).toBeNull();
  });
});

describe("formatting", () => {
  it("follows the locale", () => {
    expect(formatMoney(125050, "de").replace(/\s/g, " ")).toBe("1.250,50 €");
    expect(moneyInput(85000, "de")).toBe("850,00");
    expect(moneyInput(1, "fr")).toBe("0,01");
  });
});
