import { isLocale, negotiateLocale, type Locale } from "@hv/contracts";
import { cookies, headers } from "next/headers";
import { createTranslate, type Translate } from "./messages";

export const LOCALE_COOKIE = "locale";

/** The user's explicit choice (cookie) wins over the browser's language. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get("accept-language"));
}

export async function getTranslate(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: createTranslate(locale) };
}
