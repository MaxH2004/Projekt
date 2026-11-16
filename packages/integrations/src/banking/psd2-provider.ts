import { BankProviderNotConnectedError, type BankAccountRef, type BankDataProvider, type BankTransaction } from "./port.js";

/**
 * Platzhalter für einen lizenzierten PSD2-Anbieter (z. B. finAPI oder Tink).
 * Die Zulassung liegt beim Anbieter. Solange kein Vertrag und kein Zugang
 * bestehen, lehnt jede Methode ab; es werden keine Daten erfunden.
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
