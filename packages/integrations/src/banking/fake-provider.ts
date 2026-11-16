import type { BankAccountRef, BankDataProvider, BankTransaction } from "./port.js";

/** Provider with fixed data for tests and local development. */
export class FakeBankDataProvider implements BankDataProvider {
  readonly kind = "fake";

  constructor(
    private readonly accounts: readonly BankAccountRef[],
    private readonly transactions: Readonly<Record<string, readonly BankTransaction[]>>,
  ) {}

  async listAccounts(): Promise<BankAccountRef[]> {
    return [...this.accounts];
  }

  async fetchTransactions(providerAccountId: string, from: string, to: string): Promise<BankTransaction[]> {
    const all = this.transactions[providerAccountId];
    if (!all) throw new Error(`Unknown account: ${providerAccountId}`);
    return all.filter((t) => t.bookingDate >= from && t.bookingDate <= to);
  }
}
