import { FakeBankDataProvider } from "./fake-provider.js";
import type { BankDataProvider } from "./port.js";
import { Psd2BankDataProvider } from "./psd2-provider.js";

export type BankProviderKind = "none" | "fake" | "psd2";

/** Wählt den Anbieter nach Konfiguration (BANK_PROVIDER). `none` = keine Bankanbindung. */
export function createBankDataProvider(kind: string): BankDataProvider | null {
  switch (kind) {
    case "none":
      return null;
    case "fake":
      return new FakeBankDataProvider([], {});
    case "psd2":
      return new Psd2BankDataProvider();
    default:
      throw new RangeError(`Unbekannter BANK_PROVIDER: ${kind}`);
  }
}
