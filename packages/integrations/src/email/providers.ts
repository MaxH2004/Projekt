import { IntegrationNotConnectedError } from "../not-connected.js";
import type { EmailSender, IncomingEmail, IncomingEmailParser, OutgoingEmail } from "./port.js";

/** Placeholder for the e-mail provider still to be chosen. Sends nothing. */
export class ExternalEmailSender implements EmailSender {
  readonly kind = "external";

  send(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new IntegrationNotConnectedError("email", this.kind));
  }
}

/** Placeholder for inbound mail of the provider still to be chosen. Accepts nothing. */
export class ExternalIncomingEmailParser implements IncomingEmailParser {
  readonly kind = "external";

  parseWebhook(): Promise<IncomingEmail> {
    return Promise.reject(new IntegrationNotConnectedError("email", this.kind));
  }
}

/** Keeps sent mails in memory, for tests and local development. */
export class FakeEmailSender implements EmailSender {
  readonly kind = "fake";
  readonly sent: OutgoingEmail[] = [];

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

export type EmailProviderKind = "none" | "fake" | "external";

/** Picks the sender by configuration (EMAIL_PROVIDER). `none` = the product sends no mail. */
export function createEmailSender(kind: string): EmailSender | null {
  switch (kind) {
    case "none":
      return null;
    case "fake":
      return new FakeEmailSender();
    case "external":
      return new ExternalEmailSender();
    default:
      throw new RangeError(`Unknown EMAIL_PROVIDER: ${kind}`);
  }
}
