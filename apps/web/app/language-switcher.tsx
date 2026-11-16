import { SUPPORTED_LOCALES, type Locale } from "@hv/contracts";
import type { Translate } from "../lib/messages";
import { setLocale } from "./actions/set-locale";

export function LanguageSwitcher({ locale, t }: { locale: Locale; t: Translate }) {
  return (
    <form action={setLocale}>
      <label>
        {t("language.label")}{" "}
        <select name="locale" defaultValue={locale}>
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(`language.${code}`)}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit">{t("language.apply")}</button>
    </form>
  );
}
