import { describe, expect, it } from "vitest";
import { normalize, suggestTenancies, type MatchCandidate } from "./matching.js";

const tx = { amountCents: 85000n, counterpartyName: "Erika Müller", counterpartyIban: "DE02120300000000202051", remittanceInfo: "Rent March" };
const candidate = (tenancyId: string, overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  tenancyId,
  partyNames: [],
  knownIbans: [],
  expectedAmounts: [],
  ...overrides,
});

describe("suggestTenancies", () => {
  it("ranks a known IBAN above amount and name", () => {
    const result = suggestTenancies(tx, [
      candidate("a", { expectedAmounts: [85000n], partyNames: ["Mueller"] }),
      candidate("b", { knownIbans: ["DE02120300000000202051"] }),
      candidate("c"),
    ]);
    expect(result).toEqual([
      { tenancyId: "b", score: 4, reasons: ["known_iban"] },
      { tenancyId: "a", score: 3, reasons: ["amount_matches", "name_matches"] },
    ]);
  });

  it("matches names as whole words, with umlauts spelled either way", () => {
    expect(suggestTenancies({ ...tx, counterpartyName: "ERIKA MUELLER" }, [candidate("a", { partyNames: ["Müller"] })])[0]?.reasons).toEqual(["name_matches"]);
    expect(suggestTenancies({ ...tx, counterpartyName: "Muellerstein" }, [candidate("a", { partyNames: ["Müller"] })])).toEqual([]);
    // Names too short to be telling are ignored.
    expect(suggestTenancies({ ...tx, remittanceInfo: "Li rent" }, [candidate("a", { partyNames: ["Li"] })])).toEqual([]);
    // A company name needs all its words.
    expect(suggestTenancies({ ...tx, counterpartyName: "Sample Trading GmbH" }, [candidate("a", { partyNames: ["Sample Holding GmbH"] })])).toEqual([]);
  });

  it("suggests nothing for outgoing transactions and at most three tenancies", () => {
    const all = ["a", "b", "c", "d"].map((id) => candidate(id, { expectedAmounts: [85000n] }));
    expect(suggestTenancies({ ...tx, amountCents: -85000n }, all)).toEqual([]);
    expect(suggestTenancies(tx, all).map((s) => s.tenancyId)).toEqual(["a", "b", "c"]);
  });
});

describe("normalize", () => {
  it("spells out umlauts and removes accents and punctuation", () => {
    expect(normalize("Groß-Bäcker, José")).toBe("gross baecker jose");
  });
});
