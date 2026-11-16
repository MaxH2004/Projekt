/**
 * Schnittstelle für Bankdaten. Die Anwendung kennt nur diesen Vertrag;
 * welcher Anbieter dahinter steht (PSD2-Dienst, Dateiimport), ist austauschbar.
 */
export interface BankAccountRef {
  /** Kennung des Kontos beim Anbieter. */
  readonly providerAccountId: string;
  readonly iban: string;
  readonly holderName: string;
}

export interface BankTransaction {
  /** Stabile Kennung des Anbieters; dient zum Erkennen bereits importierter Umsätze. */
  readonly providerTransactionId: string;
  readonly bookingDate: string;
  readonly valueDate: string | null;
  /** Positiv = Eingang, negativ = Ausgang. */
  readonly amountCents: bigint;
  readonly currency: "EUR";
  readonly counterpartyName: string | null;
  readonly counterpartyIban: string | null;
  readonly remittanceInfo: string;
}

export interface BankDataProvider {
  readonly kind: string;
  listAccounts(): Promise<BankAccountRef[]>;
  /** Umsätze mit Buchungsdatum von `from` bis `to`, beide eingeschlossen. */
  fetchTransactions(providerAccountId: string, from: string, to: string): Promise<BankTransaction[]>;
}

export class BankProviderNotConnectedError extends Error {
  constructor(kind: string) {
    super(`Bankanbindung "${kind}" ist vorbereitet, aber nicht angeschlossen`);
    this.name = "BankProviderNotConnectedError";
  }
}
