import type { Account, IncomeStatement } from "@hv/contracts";
import { Fragment } from "react";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { accountName } from "../../../lib/messages";
import { formatMoney, today } from "../../../lib/money";
import { loadPortfolio } from "../../../lib/portfolio";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { locale, t } = await getTranslate();
  const requested = (await searchParams).year;
  const year = requested && /^\d{4}$/.test(requested) ? requested : today().slice(0, 4);
  const [portfolio, accounts, statement] = await Promise.all([
    loadPortfolio(),
    apiGet<Account[]>("/accounts"),
    apiGet<IncomeStatement>(`/reports/income-statement?from=${year}-01-01&to=${year}-12-31`),
  ]);
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));
  const money = (cents: number) => formatMoney(cents, locale);

  return (
    <>
      <div className="card-head">
        <h1>{t("reports.title", { year })}</h1>
        <form className="year-picker">
          <input name="year" type="number" min={2000} max={2100} defaultValue={year} aria-label={t("field.year")} />
          <button type="submit" className="secondary">
            {t("action.show")}
          </button>
        </form>
      </div>
      <p className="muted">{t("reports.hint")}</p>
      {statement.properties.length === 0 ? <p className="card muted">{t("reports.empty")}</p> : null}
      {statement.properties.map((p) => (
        <section className="card" key={p.propertyId ?? "none"}>
          <h2>{p.propertyId ? (portfolio.properties.find((x) => x.id === p.propertyId)?.name ?? "–") : t("reports.noProperty")}</h2>
          <table>
            <tbody>
              {(["income", "expense"] as const).map((type) => (
                <Fragment key={type}>
                  <tr className="group">
                    <th colSpan={2}>{t(type === "income" ? "reports.income" : "reports.expenses")}</th>
                  </tr>
                  {p.accounts
                    .filter((a) => a.type === type)
                    .map((a) => {
                      const account = accountByCode.get(a.code);
                      return (
                        <tr key={`${type}-${a.code}`}>
                          <td>
                            {a.code} {account ? accountName(t, account) : ""}
                          </td>
                          <td className="num">{money(a.amountCents)}</td>
                        </tr>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t("reports.income")}</th>
                <td className="num">{money(p.incomeCents)}</td>
              </tr>
              <tr>
                <th>{t("reports.expenses")}</th>
                <td className="num">{money(-p.expenseCents)}</td>
              </tr>
              <tr className="total">
                <th>{t("reports.result")}</th>
                <td className="num">{money(p.resultCents)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ))}
    </>
  );
}
