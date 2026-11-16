/**
 * Port for reading receipts and invoices (OCR plus language model).
 * The result is a suggestion: the user confirms every field before it is used.
 */
export interface DocumentFile {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

/** A value read from the document with the provider's confidence from 0 to 1. */
export interface Extracted<T> {
  /** null = not found in the document. */
  readonly value: T | null;
  readonly confidence: number;
}

export interface InvoiceExtraction {
  readonly invoiceDate: Extracted<string>;
  readonly invoiceNumber: Extracted<string>;
  readonly supplierName: Extracted<string>;
  /** Gross total. */
  readonly totalCents: Extracted<bigint>;
  /** Service period, needed to assign the cost to a settlement period. */
  readonly servicePeriodFrom: Extracted<string>;
  readonly servicePeriodTo: Extracted<string>;
  /** Free-text hint for the cost type; mapping to a category is done by the application. */
  readonly costTypeHint: Extracted<string>;
}

export interface DocumentExtractor {
  readonly kind: string;
  extractInvoice(file: DocumentFile): Promise<InvoiceExtraction>;
}
