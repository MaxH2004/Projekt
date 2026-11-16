import { IntegrationNotConnectedError } from "../not-connected.js";

/**
 * Port for bank data. The application only knows this contract; the provider
 * behind it (PSD2 service, file import) is interchangeable.
 */
export interface BankAccountRef {
  /** The provider's id for the account. */
  readonly providerAccountId: string;
  readonly iban: string;
  readonly holderName: string;
}

export interface BankTransaction {
  /** Stable provider id; used to detect transactions that were already imported. */
  readonly providerTransactionId: string;
  readonly bookingDate: string;
  readonly valueDate: string | null;
  /** Positive = incoming, negative = outgoing. */
  readonly amountCents: bigint;
  readonly currency: "EUR";
  readonly counterpartyName: string | null;
  readonly counterpartyIban: string | null;
  readonly remittanceInfo: string;
}

export interface BankDataProvider {
  readonly kind: string;
  listAccounts(): Promise<BankAccountRef[]>;
  /** Transactions with a booking date from `from` to `to`, both included. */
  fetchTransactions(providerAccountId: string, from: string, to: string): Promise<BankTransaction[]>;
}

export class BankProviderNotConnectedError extends IntegrationNotConnectedError {
  constructor(kind: string) {
    super("bank", kind);
    this.name = "BankProviderNotConnectedError";
  }
}
