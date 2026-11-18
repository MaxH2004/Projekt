import { z } from "zod";
import { SUPPORTED_LOCALES, type Locale } from "./locale.js";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);
const totpCodeSchema = z.string().regex(/^\d{6}$/);
/** Twelve base32 characters, written in three groups of four; dashes and case do not matter. */
export const recoveryCodeSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-7]{12}$/));

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
  /** Instead of a TOTP code, when the authenticator is lost. Each code works once. */
  recoveryCode: recoveryCodeSchema.optional(),
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

export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });
export const emailChangeSchema = z.object({ password: z.string().min(1).max(200), email: emailSchema });

/** Confirms a sensitive change with the password and, when two-factor authentication is on, a code. */
export const secondFactorConfirmSchema = z
  .object({ password: z.string().min(1).max(200), totpCode: totpCodeSchema.optional(), recoveryCode: recoveryCodeSchema.optional() })
  .refine((v) => Boolean(v.totpCode) !== Boolean(v.recoveryCode), { path: ["totpCode"] });

export interface RecoveryCodesResponse {
  /** Shown once; only hashes are stored. */
  readonly codes: readonly string[];
}
