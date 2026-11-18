import { OPERATING_COST_CATEGORY_KEYS, type Account, type BankTransactionView } from "@hv/contracts";
import { Field } from "../../../components/field";
import { ActionButton, Form } from "../../../components/form";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { formatDate, formatMoney } from "../../../lib/money";
import { accountName } from "../../../lib/messages";
import { loadPortfolio } from "../../../lib/portfolio";
import { bookTransaction, bookTransactionAsExpense, importStatement, setTransactionIgnored } from "../../actions/finance";

export default async function BankPage() {
  const { locale, t } = await getTranslate();
  const [portfolio, all, accounts] = await Promise.all([loadPortfolio(), apiGet<BankTransactionView[]>("/bank-transactions"), apiGet<Account[]>("/accounts")]);
  const open = all.filter((tx) => tx.status === "open");
  const ignored = all.filter((tx) => tx.status === "ignored");
  const expenseAccounts = accounts.filter((a) => a.forExpenses);

  return (
    <>
      <h1>{t("bank.title")}</h1>
      <section className="card">
        <h2>{t("bank.import")}</h2>
        <p className="muted">{t("bank.importHint")}</p>
        <Form action={importStatement} submit={t("bank.importSubmit")} className="form inline">
          <Field label={t("field.statementFile")}>
            <input name="file" type="file" accept=".xml,application/xml,text/xml" required />
          </Field>
        </Form>
      </section>

      <section className="card">
        <h2>{t("bank.open", { count: open.length })}</h2>
        {open.length === 0 ? <p className="muted">{t("bank.noOpen")}</p> : null}
        <ul className="transactions">
          {open.map((tx) => (
            <li key={tx.id} className="transaction">
              <div className="transaction-head">
                <span>{formatDate(tx.bookingDate, locale)}</span>
                <strong>{tx.counterpartyName ?? "–"}</strong>
                <span className="muted">{tx.remittanceInfo}</span>
                <span className={tx.amountCents > 0 ? "amount in" : "amount out"}>{formatMoney(tx.amountCents, locale)}</span>
              </div>
              {tx.amountCents > 0 ? (
                <Form action={bookTransaction.bind(null, tx.id)} submit={t("bank.bookPayment")} className="form inline">
                  <Field label={t("field.tenancy")} wide>
                    <select name="tenancyId" required defaultValue={tx.suggestions[0]?.tenancyId ?? ""}>
                      <option value="" disabled>
                        {t("bank.chooseTenancy")}
                      </option>
                      {tx.suggestions.length > 0 ? (
                        <optgroup label={t("bank.suggested")}>
                          {tx.suggestions.map((s) => (
                            <option key={s.tenancyId} value={s.tenancyId}>
                              {portfolio.tenancyLabel(s.tenancyId)} ({s.reasons.map((r) => t(`match.${r}`)).join(", ")})
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <optgroup label={t("bank.allTenancies")}>
                        {portfolio.tenancies.map((tn) => (
                          <option key={tn.id} value={tn.id}>
                            {portfolio.tenancyLabel(tn.id)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </Field>
                </Form>
              ) : (
                <Form action={bookTransactionAsExpense.bind(null, tx.id, -tx.amountCents)} submit={t("bank.bookExpense")} className="form inline">
                  <Field label={t("field.account")}>
                    <select name="accountCode" required data-field="lines.0.accountCode" defaultValue="">
                      <option value="" disabled>
                        {t("expenses.chooseAccount")}
                      </option>
                      {expenseAccounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {accountName(t, a)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("field.property")}>
                    <select name="propertyId" required data-field="lines.0.propertyId">
                      {portfolio.properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("field.operatingCostCategory")}>
                    <select name="operatingCostCategory" defaultValue="">
                      <option value="">{t("category.none")}</option>
                      {OPERATING_COST_CATEGORY_KEYS.map((c) => (
                        <option key={c} value={c}>
                          {t(`category.${c}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("field.description")}>
                    <input name="description" maxLength={500} />
                  </Field>
                </Form>
              )}
              <ActionButton action={setTransactionIgnored.bind(null, tx.id, true)} label={t("bank.ignore")} className="link-button" />
            </li>
          ))}
        </ul>
      </section>

      {ignored.length > 0 ? (
        <details className="card">
          <summary>{t("bank.ignored", { count: ignored.length })}</summary>
          <table>
            <tbody>
              {ignored.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatDate(tx.bookingDate, locale)}</td>
                  <td>{tx.counterpartyName ?? "–"}</td>
                  <td className="num">{formatMoney(tx.amountCents, locale)}</td>
                  <td className="actions">
                    <ActionButton action={setTransactionIgnored.bind(null, tx.id, false)} label={t("bank.unignore")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </>
  );
}
