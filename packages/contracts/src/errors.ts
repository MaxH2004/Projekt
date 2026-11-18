/**
 * Error codes the API returns as `{ "code": "..." }`. The interface maps them
 * to translated messages; the API never sends sentences.
 */
export const ERROR_CODES = [
  "validation_failed",
  "unauthenticated",
  "invalid_credentials",
  "account_locked",
  "totp_required",
  "invalid_totp",
  "totp_not_set_up",
  "totp_already_enabled",
  "email_taken",
  "not_found",
  "conflict",
  "rate_limited",
  "file_type_not_accepted",
  "credit_insufficient",
  "file_too_large",
  "file_storage_unavailable",
  "allocation_exceeds_open_amount",
  "bank_statement_unreadable",
  "bank_transaction_not_bookable",
  "settlement_unit_area",
  "settlement_key_missing",
  "settlement_persons_missing",
  "settlement_nothing_to_settle",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorResponse {
  readonly code: ErrorCode;
  /** For validation_failed: the paths of the offending fields. */
  readonly fields?: readonly string[];
}
