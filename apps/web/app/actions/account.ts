"use server";

import type { TotpSetupResponse } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { api, TOTP_SETUP_COOKIE } from "../../lib/api";
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
    await api("POST", "/auth/totp/enable", { code: fields(data).text("code") });
    (await cookies()).delete({ name: TOTP_SETUP_COOKIE, path: "/account" });
    revalidatePath("/account");
  });
}
