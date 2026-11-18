import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslate } from "../lib/locale";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return { title: t("app.name") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getTranslate();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
