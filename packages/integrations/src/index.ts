export { IntegrationNotConnectedError } from "./not-connected.js";

export {
  BankProviderNotConnectedError,
  type BankAccountRef,
  type BankDataProvider,
  type BankTransaction,
} from "./banking/port.js";
export { FakeBankDataProvider } from "./banking/fake-provider.js";
export { Psd2BankDataProvider } from "./banking/psd2-provider.js";
export { createBankDataProvider, type BankProviderKind } from "./banking/factory.js";
export { CamtFormatError, parseCamt053, type CamtStatement } from "./banking/camt.js";

export type { EmailAttachment, EmailSender, IncomingEmail, IncomingEmailParser, OutgoingEmail } from "./email/port.js";
export {
  createEmailSender,
  ExternalEmailSender,
  ExternalIncomingEmailParser,
  FakeEmailSender,
  type EmailProviderKind,
} from "./email/providers.js";

export type { DocumentExtractor, DocumentFile, Extracted, InvoiceExtraction } from "./document-extraction/port.js";
export {
  createDocumentExtractor,
  EMPTY_INVOICE_EXTRACTION,
  ExternalDocumentExtractor,
  FakeDocumentExtractor,
  type DocumentExtractionProviderKind,
} from "./document-extraction/providers.js";

export type {
  CheckoutRequest,
  SubscriptionBilling,
  SubscriptionEvent,
  SubscriptionState,
  SubscriptionStatus,
} from "./subscription-billing/port.js";
export {
  createSubscriptionBilling,
  ExternalSubscriptionBilling,
  FakeSubscriptionBilling,
  type SubscriptionBillingProviderKind,
} from "./subscription-billing/providers.js";

export { assertSafeKey, FileStorageNotConnectedError, type FileStorage } from "./file-storage/port.js";
export { createFileStorage, FakeFileStorage, LocalFileStorage, ObjectStorage, type FileStorageKind } from "./file-storage/providers.js";
export { ACCEPTED_FILE_TYPES, detectFileType, type AcceptedFileType } from "./file-storage/content-type.js";
