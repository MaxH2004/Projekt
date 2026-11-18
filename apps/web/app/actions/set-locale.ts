"use server";

import { isLocale } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { apiRequest } from "../../lib/api";
import { LOCALE_COOKIE } from "../../lib/locale";

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Signed in: remember it for the user, so it follows them to other devices.
  // Signed out the API answers 401, which changes nothing.
  await apiRequest("POST", "/auth/locale", { locale });
  revalidatePath("/", "layout");
}
