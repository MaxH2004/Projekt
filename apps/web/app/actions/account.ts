"use server";

import type { RecoveryCodesResponse, TotpSetupResponse } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { api, RECOVERY_CODES_COOKIE, TOTP_SETUP_COOKIE } from "../../lib/api";
import { config } from "../../lib/config";
import { fields, formAction, type FormState } from "../../lib/form";

export async function startTotpSetup(previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    const setup = await api<TotpSetupResponse>("POST", "/auth/totp/setup");
    (await cookies()).set(TOTP_SETUP_COOKIE, JSON.stringify(setup), {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/account",
      maxAge: 15 * 60,
    });
    revalidatePath("/account");
  });
}

export async function enableTotp(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const { codes } = await api<RecoveryCodesResponse>("POST", "/auth/totp/enable", { code: fields(data).text("code") });
    (await cookies()).delete({ name: TOTP_SETUP_COOKIE, path: "/account" });
    await showRecoveryCodes(codes);
    revalidatePath("/account");
  });
}

/** The codes stay readable for a few minutes, only on the account page, until the user confirms. */
async function showRecoveryCodes(codes: readonly string[]): Promise<void> {
  (await cookies()).set(RECOVERY_CODES_COOKIE, JSON.stringify(codes), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/account",
    maxAge: 10 * 60,
  });
}

export async function dismissRecoveryCodes(): Promise<FormState> {
  (await cookies()).delete({ name: RECOVERY_CODES_COOKIE, path: "/account" });
  revalidatePath("/account");
  return {};
}

/** Password plus either a code from the app or a recovery code, from one field. */
function confirmation(data: FormData) {
  const f = fields(data);
  const code = f.text("code");
  return { password: f.text("password"), ...(/^\d{6}$/.test(code) ? { totpCode: code } : { recoveryCode: code }) };
}

export async function regenerateRecoveryCodes(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const { codes } = await api<RecoveryCodesResponse>("POST", "/auth/totp/recovery-codes", confirmation(data));
    await showRecoveryCodes(codes);
    revalidatePath("/account");
  });
}

export async function disableTotp(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", "/auth/totp/disable", confirmation(data));
    revalidatePath("/account");
  });
}

export async function changePassword(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("POST", "/auth/password", { currentPassword: f.text("currentPassword"), newPassword: f.text("newPassword") });
  });
}

export async function changeEmail(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("POST", "/auth/email", { password: f.text("password"), email: f.text("email") });
    revalidatePath("/account");
  });
}

export async function saveOrganizationDetails(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("PUT", "/organization/details", {
      street: f.optionalText("street"),
      postalCode: f.optionalText("postalCode"),
      city: f.optionalText("city"),
      accountHolder: f.optionalText("accountHolder"),
      iban: f.optionalText("iban"),
    });
    revalidatePath("/account");
  });
}
