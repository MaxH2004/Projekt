import type { ReactNode } from "react";
import { LanguageSwitcher } from "../language-switcher";
import { getTranslate } from "../../lib/locale";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getTranslate();
  return (
    <div className="public">
      <header className="public-header">
        <span className="brand">{t("app.name")}</span>
        <LanguageSwitcher locale={locale} t={t} />
      </header>
      <main className="public-main">{children}</main>
    </div>
  );
}
