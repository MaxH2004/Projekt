import { BankProviderNotConnectedError, type BankAccountRef, type BankDataProvider, type BankTransaction } from "./port.js";

/**
 * Placeholder for a licensed PSD2 provider (e.g. finAPI or Tink). The licence
 * sits with the provider. As long as there is no contract and no access, every
 * method rejects; no data is made up.
 */
export class Psd2BankDataProvider implements BankDataProvider {
  readonly kind = "psd2";

  listAccounts(): Promise<BankAccountRef[]> {
    return Promise.reject(new BankProviderNotConnectedError(this.kind));
  }

  fetchTransactions(): Promise<BankTransaction[]> {
    return Promise.reject(new BankProviderNotConnectedError(this.kind));
  }
}
