import type { BankTransactionView, RentCharge } from "@hv/contracts";
import Link from "next/link";
import { apiGet } from "../../lib/api";
import { getTranslate } from "../../lib/locale";
import { formatMoney, today } from "../../lib/money";
import { loadPortfolio } from "../../lib/portfolio";

export default async function OverviewPage() {
  const { locale, t } = await getTranslate();
  const [portfolio, open, bank] = await Promise.all([
    loadPortfolio(),
    apiGet<RentCharge[]>("/charges?status=open"),
    apiGet<BankTransactionView[]>("/bank-transactions?status=open"),
  ]);
  const day = today();
  const overdue = open.filter((c) => c.dueDate <= day);
  const overdueTotal = overdue.reduce((s, c) => s + c.openCents, 0);
  const running = portfolio.tenancies.filter((tn) => tn.startDate <= day && (tn.endDate === null || tn.endDate >= day));

  const byTenancy = new Map<string, number>();
  for (const c of overdue) byTenancy.set(c.tenancyId, (byTenancy.get(c.tenancyId) ?? 0) + c.openCents);

  return (
    <>
      <h1>{t("overview.title")}</h1>
      {portfolio.properties.length === 0 ? (
        <section className="card callout">
          <h2>{t("overview.start.title")}</h2>
          <p>{t("overview.start.text")}</p>
          <Link className="button" href="/properties">
            {t("overview.start.action")}
          </Link>
        </section>
      ) : null}
      <div className="stats">
        <Link href="/properties" className="stat">
          <span className="stat-value">{portfolio.units.length}</span>
          <span className="stat-label">{t("overview.units")}</span>
        </Link>
        <Link href="/tenancies" className="stat">
          <span className="stat-value">{running.length}</span>
          <span className="stat-label">{t("overview.runningTenancies")}</span>
        </Link>
        <Link href="/rent" className={overdueTotal > 0 ? "stat warn" : "stat"}>
          <span className="stat-value">{formatMoney(overdueTotal, locale)}</span>
          <span className="stat-label">{t("overview.overdue")}</span>
        </Link>
        <Link href="/bank" className={bank.length > 0 ? "stat warn" : "stat"}>
          <span className="stat-value">{bank.length}</span>
          <span className="stat-label">{t("overview.openTransactions")}</span>
        </Link>
      </div>
      <section className="card">
        <h2>{t("overview.overdueByTenancy")}</h2>
        {byTenancy.size === 0 ? (
          <p className="muted">{t("overview.nothingOverdue")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.tenancy")}</th>
                <th className="num">{t("field.open")}</th>
              </tr>
            </thead>
            <tbody>
              {[...byTenancy].map(([id, cents]) => (
                <tr key={id}>
                  <td>
                    <Link href={`/tenancies/${id}`}>{portfolio.tenancyLabel(id)}</Link>
                  </td>
                  <td className="num">{formatMoney(cents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
