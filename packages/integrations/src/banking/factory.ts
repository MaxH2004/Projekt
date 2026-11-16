import { FakeBankDataProvider } from "./fake-provider.js";
import type { BankDataProvider } from "./port.js";
import { Psd2BankDataProvider } from "./psd2-provider.js";

export type BankProviderKind = "none" | "fake" | "psd2";

/** Picks the provider by configuration (BANK_PROVIDER). `none` = no bank connection. */
export function createBankDataProvider(kind: string): BankDataProvider | null {
  switch (kind) {
    case "none":
      return null;
    case "fake":
      return new FakeBankDataProvider([], {});
    case "psd2":
      return new Psd2BankDataProvider();
    default:
      throw new RangeError(`Unknown BANK_PROVIDER: ${kind}`);
  }
}
