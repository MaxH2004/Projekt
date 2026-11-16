import type { Locale } from "@hv/contracts";
import { createTranslator } from "./i18n.js";
import { paymentReminder, type PaymentReminderData } from "./templates/payment-reminder.js";

export { CATALOGS, createTranslator, type Translator } from "./i18n.js";
export type { Catalog, MessageKey } from "./locales/de.js";
export type { PaymentReminderData } from "./templates/payment-reminder.js";

/** Data each template needs. A new template is added here and in `TEMPLATES`. */
export interface TemplateData {
  "payment-reminder": PaymentReminderData;
}
export type TemplateId = keyof TemplateData;

const TEMPLATES: { [K in TemplateId]: (tr: ReturnType<typeof createTranslator>, data: TemplateData[K]) => string } = {
  "payment-reminder": paymentReminder,
};

/** Renders a document as a complete HTML page in the given language. */
export function renderTemplate<K extends TemplateId>(id: K, locale: Locale, data: TemplateData[K]): string {
  return TEMPLATES[id](createTranslator(locale), data);
}
