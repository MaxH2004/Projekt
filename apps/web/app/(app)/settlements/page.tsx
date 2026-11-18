import type { SettlementSummary } from "@hv/contracts";
import Link from "next/link";
import { Field } from "../../../components/field";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { formatDate, today } from "../../../lib/money";
import { loadPortfolio } from "../../../lib/portfolio";

export default async function SettlementsPage() {
  const { locale, t } = await getTranslate();
  const [portfolio, settlements] = await Promise.all([loadPortfolio(), apiGet<SettlementSummary[]>("/settlements")]);
  const lastYear = String(Number(today().slice(0, 4)) - 1);
  return (
    <>
      <h1>{t("settlements.title")}</h1>
      <section className="card">
        <h2>{t("settlements.new")}</h2>
        <p className="muted">{t("settlements.newHint")}</p>
        {portfolio.properties.length === 0 ? (
          <p className="muted">{t("expenses.needsProperty")}</p>
        ) : (
          <form method="get" action="/settlements/new" className="form inline">
            <Field label={t("field.property")}>
              <select name="propertyId" required>
                {portfolio.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.fromMonth")}>
              <input name="from" type="month" required defaultValue={`${lastYear}-01`} />
            </Field>
            <Field label={t("field.toMonth")}>
              <input name="to" type="month" required defaultValue={`${lastYear}-12`} />
            </Field>
            <div className="form-actions">
              <button type="submit">{t("settlements.prepare")}</button>
            </div>
          </form>
        )}
      </section>
      <section className="card">
        <h2>{t("settlements.done")}</h2>
        {settlements.length === 0 ? (
          <p className="muted">{t("settlements.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.property")}</th>
                <th>{t("field.period")}</th>
                <th className="num">{t("settlements.statements")}</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/settlements/${s.id}`}>{portfolio.properties.find((p) => p.id === s.propertyId)?.name ?? "–"}</Link>
                  </td>
                  <td>
                    {formatDate(s.from, locale)} – {formatDate(s.to, locale)}
                    {s.cancelled ? <span className="badge">{t("settlements.cancelledBadge")}</span> : null}
                  </td>
                  <td className="num">{s.statementCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
