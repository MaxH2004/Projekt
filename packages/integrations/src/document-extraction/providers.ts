import { IntegrationNotConnectedError } from "../not-connected.js";
import type { DocumentExtractor, InvoiceExtraction } from "./port.js";

/** Placeholder for the extraction provider still to be chosen. Reads nothing. */
export class ExternalDocumentExtractor implements DocumentExtractor {
  readonly kind = "external";

  extractInvoice(): Promise<InvoiceExtraction> {
    return Promise.reject(new IntegrationNotConnectedError("document-extraction", this.kind));
  }
}

const notFound = { value: null, confidence: 0 } as const;

/** An extraction in which nothing was recognized; the user fills in every field. */
export const EMPTY_INVOICE_EXTRACTION: InvoiceExtraction = {
  invoiceDate: notFound,
  invoiceNumber: notFound,
  supplierName: notFound,
  totalCents: notFound,
  servicePeriodFrom: notFound,
  servicePeriodTo: notFound,
  costTypeHint: notFound,
};

/** Returns a fixed result per filename, for tests and local development. */
export class FakeDocumentExtractor implements DocumentExtractor {
  readonly kind = "fake";

  constructor(private readonly results: Readonly<Record<string, InvoiceExtraction>> = {}) {}

  async extractInvoice(file: { filename: string }): Promise<InvoiceExtraction> {
    return this.results[file.filename] ?? EMPTY_INVOICE_EXTRACTION;
  }
}

export type DocumentExtractionProviderKind = "none" | "fake" | "external";

/** Picks the extractor by configuration (DOCUMENT_EXTRACTION_PROVIDER). `none` = manual entry only. */
export function createDocumentExtractor(kind: string): DocumentExtractor | null {
  switch (kind) {
    case "none":
      return null;
    case "fake":
      return new FakeDocumentExtractor();
    case "external":
      return new ExternalDocumentExtractor();
    default:
      throw new RangeError(`Unknown DOCUMENT_EXTRACTION_PROVIDER: ${kind}`);
  }
}
