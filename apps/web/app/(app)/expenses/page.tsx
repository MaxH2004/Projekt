import { OPERATING_COST_CATEGORY_KEYS, type Account, type DocumentInfo, type Expense } from "@hv/contracts";
import { Documents } from "../../../components/documents";
import { ExpenseLines } from "../../../components/expense-lines";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { accountName } from "../../../lib/messages";
import { formatDate, formatMoney, today } from "../../../lib/money";
import { loadPortfolio } from "../../../lib/portfolio";
import { recordExpense, reverseExpense } from "../../actions/finance";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { locale, t } = await getTranslate();
  const requested = (await searchParams).year;
  const year = requested && /^\d{4}$/.test(requested) ? requested : today().slice(0, 4);
  const [portfolio, accounts, expenses, receipts] = await Promise.all([
    loadPortfolio(),
    apiGet<Account[]>("/accounts"),
    apiGet<Expense[]>(`/expenses?from=${year}-01-01&to=${year}-12-31`),
    apiGet<DocumentInfo[]>("/documents?receipts=true"),
  ]);
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));
  const property = (id: string) => portfolio.properties.find((p) => p.id === id)?.name ?? "–";
  const total = expenses.filter((e) => !e.reversed).reduce((s, e) => s + e.amountCents, 0);

  return (
    <>
      <h1>{t("expenses.title")}</h1>
      <section className="card">
        <h2>{t("expenses.new")}</h2>
        {portfolio.properties.length === 0 ? (
          <p className="muted">{t("expenses.needsProperty")}</p>
        ) : (
          <Form action={recordExpense} submit={t("action.save")} className="form inline">
            <Field label={t("field.paidOn")}>
              <input name="paidOn" type="date" required defaultValue={today()} />
            </Field>
            <Field label={t("field.paidFrom")}>
              <select name="paidFrom" defaultValue="bank">
                <option value="bank">{t("paidFrom.bank")}</option>
                <option value="private">{t("paidFrom.private")}</option>
              </select>
            </Field>
            <Field label={t("field.vendor")}>
              <input name="vendor" maxLength={200} />
            </Field>
            <Field label={t("field.description")}>
              <input name="description" maxLength={500} />
            </Field>
            <ExpenseLines
              accounts={accounts.filter((a) => a.forExpenses).map((a) => ({ value: a.code, label: `${a.code} ${accountName(t, a)}` }))}
              properties={portfolio.properties.map((p) => ({ value: p.id, label: p.name }))}
              categories={[{ value: "", label: t("category.none") }, ...OPERATING_COST_CATEGORY_KEYS.map((c) => ({ value: c, label: t(`category.${c}`) }))]}
              labels={{
                account: t("field.account"),
                property: t("field.property"),
                amount: t("field.amount"),
                category: t("field.operatingCostCategory"),
                chooseAccount: t("expenses.chooseAccount"),
                add: t("expenses.addLine"),
                remove: t("expenses.removeLine"),
                // Filled per line in the browser.
                line: t("expenses.line", { number: "{number}" }),
              }}
            />
            <Field label={t("documents.receipt")} hint={t("documents.fileHint")}>
              <input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
            </Field>
          </Form>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>
            {t("expenses.list", { year })} <span className="muted">{formatMoney(total, locale)}</span>
          </h2>
          <form className="year-picker">
            <input name="year" type="number" min={2000} max={2100} defaultValue={year} aria-label={t("field.year")} />
            <button type="submit" className="secondary">
              {t("action.show")}
            </button>
          </form>
        </div>
        {expenses.length === 0 ? (
          <p className="muted">{t("expenses.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.paidOn")}</th>
                <th>{t("field.vendor")}</th>
                <th>{t("field.account")}</th>
                <th>{t("field.property")}</th>
                <th className="num">{t("field.amount")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className={e.reversed ? "struck" : undefined}>
                  <td>{formatDate(e.paidOn, locale)}</td>
                  <td>
                    {e.vendor ?? "–"}
                    {e.description ? <div className="muted small">{e.description}</div> : null}
                  </td>
                  <td>
                    {e.lines.map((l, i) => {
                      const account = accountByCode.get(l.accountCode);
                      return (
                        <div key={i}>
                          {account ? accountName(t, account) : l.accountCode}
                          {l.operatingCostCategory ? <span className="badge">{t(`category.${l.operatingCostCategory}`)}</span> : null}
                        </div>
                      );
                    })}
                  </td>
                  <td>
                    {e.lines.map((l, i) => (
                      <div key={i}>{property(l.propertyId)}</div>
                    ))}
                  </td>
                  <td className="num">{formatMoney(e.amountCents, locale)}</td>
                  <td className="actions">
                    <details className="receipts">
                      <summary>{t("documents.receipts", { count: receipts.filter((r) => r.expenseId === e.id).length })}</summary>
                      <Documents documents={receipts.filter((r) => r.expenseId === e.id)} target={{ expenseId: e.id, path: "/expenses" }} kinds={["receipt"]} locale={locale} t={t} />
                    </details>
                    {e.reversed ? (
                      t("expenses.reversed")
                    ) : (
                      <details>
                        <summary>{t("expenses.reverse")}</summary>
                        <Form action={reverseExpense.bind(null, e.id)} submit={t("expenses.reverse")} className="form compact">
                          <Field label={t("field.bookingDate")}>
                            <input name="bookingDate" type="date" required defaultValue={today()} />
                          </Field>
                        </Form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
