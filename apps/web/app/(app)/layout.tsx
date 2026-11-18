import type { MeResponse } from "@hv/contracts";
import type { ReactNode } from "react";
import { NavLink } from "../../components/nav-link";
import { apiGet } from "../../lib/api";
import { getTranslate } from "../../lib/locale";
import type { MessageKey } from "../../lib/messages";
import { logout } from "../actions/auth";
import { LanguageSwitcher } from "../language-switcher";

const NAV: [string, MessageKey][] = [
  ["/", "nav.overview"],
  ["/properties", "nav.properties"],
  ["/persons", "nav.persons"],
  ["/tenancies", "nav.tenancies"],
  ["/rent", "nav.rent"],
  ["/bank", "nav.bank"],
  ["/expenses", "nav.expenses"],
  ["/settlements", "nav.settlements"],
  ["/deadlines", "nav.deadlines"],
  ["/reports", "nav.reports"],
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await apiGet<MeResponse>("/auth/me");
  const { locale, t } = await getTranslate();
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">{t("app.name")}</span>
        <span className="org">{me.organizationName}</span>
        <div className="header-tools">
          <LanguageSwitcher locale={locale} t={t} />
          <NavLink href="/account" label={t("nav.account")} />
          <form action={logout}>
            <button type="submit" className="link-button">
              {t("nav.logout")}
            </button>
          </form>
        </div>
      </header>
      <nav className="app-nav" aria-label={t("nav.label")}>
        {NAV.map(([href, key]) => (
          <NavLink key={href} href={href} label={t(key)} />
        ))}
      </nav>
      <main className="app-main">{children}</main>
    </div>
  );
}
