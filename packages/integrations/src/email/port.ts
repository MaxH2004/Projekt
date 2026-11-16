/**
 * Port for e-mail. Outgoing: notifications, payment reminders, statements,
 * account mails. Incoming: receipts that users forward to their inbox address.
 */
export interface EmailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  /** Plain-text body; always required so every client can show the mail. */
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly attachments?: readonly EmailAttachment[];
}

export interface EmailSender {
  readonly kind: string;
  /** Hands the mail to the provider. Resolves once the provider accepted it, not on delivery. */
  send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** A mail received on an inbox address, already parsed by the provider adapter. */
export interface IncomingEmail {
  readonly providerMessageId: string;
  readonly from: string;
  /** The inbox address it was sent to; identifies the organization. */
  readonly to: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly attachments: readonly EmailAttachment[];
}

export interface IncomingEmailParser {
  readonly kind: string;
  /**
   * Verifies and parses a provider's inbound webhook call. Must reject calls
   * whose signature does not match, so nobody can inject receipts.
   */
  parseWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<IncomingEmail>;
}
