import { z } from "zod";
import { SUPPORTED_LOCALES, type Locale } from "./locale.js";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);
const totpCodeSchema = z.string().regex(/^\d{6}$/);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(1).max(200),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No length rule on login: old passwords must stay usable if the rule changes.
  password: z.string().min(1).max(200),
  totpCode: totpCodeSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const totpEnableRequestSchema = z.object({ code: totpCodeSchema });
export type TotpEnableRequest = z.infer<typeof totpEnableRequestSchema>;

export interface MeResponse {
  readonly userId: string;
  readonly email: string;
  readonly locale: Locale;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly totpEnabled: boolean;
}

export interface TotpSetupResponse {
  /** Base32 secret for manual entry. */
  readonly secret: string;
  /** otpauth:// URI for QR codes. */
  readonly uri: string;
}
