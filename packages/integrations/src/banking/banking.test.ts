import { describe, expect, it } from "vitest";
import { BankProviderNotConnectedError, createBankDataProvider, FakeBankDataProvider, type BankTransaction } from "../index.js";

const tx = (id: string, bookingDate: string, amountCents: bigint): BankTransaction => ({
  providerTransactionId: id,
  bookingDate,
  valueDate: bookingDate,
  amountCents,
  currency: "EUR",
  counterpartyName: "Erika Musterfrau",
  counterpartyIban: "DE02120300000000202051",
  remittanceInfo: "Rent",
});

describe("bank data", () => {
  it("returns transactions within the period including both bounds", async () => {
    const provider = new FakeBankDataProvider(
      [{ providerAccountId: "k1", iban: "DE89370400440532013000", holderName: "Max Mustermann" }],
      { k1: [tx("a", "2025-02-28", 80_000n), tx("b", "2025-03-01", 80_000n), tx("c", "2025-03-31", -4_200n), tx("d", "2025-04-01", 80_000n)] },
    );
    const result = await provider.fetchTransactions("k1", "2025-03-01", "2025-03-31");
    expect(result.map((t) => t.providerTransactionId)).toEqual(["b", "c"]);
    await expect(provider.fetchTransactions("unknown", "2025-03-01", "2025-03-31")).rejects.toThrow(/Unknown account/);
  });

  it("reports PSD2 as prepared but not connected", async () => {
    const provider = createBankDataProvider("psd2")!;
    await expect(provider.listAccounts()).rejects.toBeInstanceOf(BankProviderNotConnectedError);
    await expect(provider.fetchTransactions("k1", "2025-03-01", "2025-03-31")).rejects.toBeInstanceOf(BankProviderNotConnectedError);
  });

  it("picks the provider by configuration", () => {
    expect(createBankDataProvider("none")).toBeNull();
    expect(createBankDataProvider("fake")?.kind).toBe("fake");
    expect(() => createBankDataProvider("finapi")).toThrow(RangeError);
  });
});
