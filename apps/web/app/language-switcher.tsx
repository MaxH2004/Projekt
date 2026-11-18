import { SUPPORTED_LOCALES, type Locale } from "@hv/contracts";
import type { Translate } from "../lib/messages";
import { setLocale } from "./actions/set-locale";

export function LanguageSwitcher({ locale, t }: { locale: Locale; t: Translate }) {
  return (
    <form action={setLocale} className="language-form">
      <label className="language-form">
        <span className="muted small">{t("language.label")}</span>
        <select name="locale" defaultValue={locale}>
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(`language.${code}`)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="secondary">
        {t("language.apply")}
      </button>
    </form>
  );
}
