"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adoptSession, ApiFailure, apiRequest, SESSION_COOKIE } from "../../lib/api";
import { fields, formAction, type FormState } from "../../lib/form";
import { getLocale } from "../../lib/locale";

async function failOn(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await res.json()) as { code: never; fields?: string[] };
  throw new ApiFailure(res.status, body.code, body.fields);
}

export async function login(previous: FormState, data: FormData): Promise<FormState> {
  const state = await formAction(previous, async () => {
    const f = fields(data);
    // One field for both: six digits from the app, or a recovery code.
    const code = f.optionalText("totpCode");
    const factor = !code ? {} : /^\d{6}$/.test(code) ? { totpCode: code } : { recoveryCode: code };
    const res = await apiRequest("POST", "/auth/login", { email: f.text("email"), password: f.text("password"), ...factor });
    await failOn(res);
    await adoptSession(res);
  });
  if (state.error) return state;
  redirect("/");
}

export async function register(previous: FormState, data: FormData): Promise<FormState> {
  const state = await formAction(previous, async () => {
    const f = fields(data);
    const res = await apiRequest("POST", "/auth/register", {
      email: f.text("email"),
      password: f.text("password"),
      organizationName: f.text("organizationName"),
      locale: await getLocale(),
    });
    await failOn(res);
    await adoptSession(res);
  });
  if (state.error) return state;
  redirect("/");
}

export async function logout(): Promise<void> {
  await apiRequest("POST", "/auth/logout");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
