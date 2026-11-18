import type { Settlement } from "@hv/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiFailure, apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatDate, formatMoney } from "../../../../lib/money";
import { loadPortfolio } from "../../../../lib/portfolio";

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await getTranslate();
  let settlement: Settlement;
  try {
    settlement = await apiGet<Settlement>(`/settlements/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiFailure && err.code === "not_found") notFound();
    throw err;
  }
  const portfolio = await loadPortfolio();
  const property = portfolio.properties.find((p) => p.id === settlement.propertyId);
  const money = (cents: number) => formatMoney(cents, locale);
  const { result } = settlement;

  return (
    <>
      <p className="breadcrumb">
        <Link href="/settlements">{t("settlements.title")}</Link>
      </p>
      <h1>
        {property?.name} · {formatDate(settlement.from, locale)} – {formatDate(settlement.to, locale)}
      </h1>
      <p className="muted">
        {t("settlements.finalizedOn", { date: formatDate(settlement.createdAt.slice(0, 10), locale) })} · {t("settlements.deadline", { date: formatDate(result.deadline, locale) })}
      </p>
      <section className="card">
        <h2>{t("settlements.statements")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("field.tenancy")}</th>
              <th className="num">{t("settlements.costShare")}</th>
              <th className="num">{t("settlements.advancesPaid")}</th>
              <th className="num">{t("settlements.balance")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.statements.map((s) => (
              <tr key={s.tenancyId}>
                <td>
                  <Link href={`/tenancies/${s.tenancyId}`}>{portfolio.tenancyLabel(s.tenancyId)}</Link>
                </td>
                <td className="num">{money(s.totalCents)}</td>
                <td className="num">{money(s.advancesPaidCents)}</td>
                <td className="num">
                  {s.balanceCents >= 0 ? t("settlements.toPay", { amount: money(s.balanceCents) }) : t("settlements.toRefund", { amount: money(-s.balanceCents) })}
                </td>
                <td className="actions">
                  <a href={`/settlements/${settlement.id}/statement/${s.tenancyId}`} target="_blank" rel="noopener">
                    {t("settlements.openStatement")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{t("settlements.landlordShare")}</th>
              <td className="num">{money(result.landlordCents)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
        <p className="muted">{t("settlements.chargesHint", { date: formatDate(settlement.dueDate, locale) })}</p>
      </section>
      <section className="card">
        <h2>{t("settlements.costs")}</h2>
        <table>
          <tbody>
            {result.costs.map((c) => (
              <tr key={c.category}>
                <td>{t(`category.${c.category}`)}</td>
                <td>{t(`settlementKey.${c.key}`)}</td>
                <td className="num">{money(c.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
