import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslate } from "../lib/locale";
import { LanguageSwitcher } from "./language-switcher";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return { title: t("app.name") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getTranslate();
  return (
    <html lang={locale}>
      <body>
        <header>
          <LanguageSwitcher locale={locale} t={t} />
        </header>
        {children}
      </body>
    </html>
  );
}
