import { RENT_COMPONENT_KINDS, type CreditRefund, type DocumentInfo, type OrganizationDetails, type Payment, type RentCharge, type TenancyBalance } from "@hv/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Documents } from "../../../../components/documents";
import { Field } from "../../../../components/field";
import { ActionButton, Form } from "../../../../components/form";
import { apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatDate, formatMonth, formatMoney, moneyInput, today } from "../../../../lib/money";
import { loadPortfolio, personName } from "../../../../lib/portfolio";
import { applyCredit, cancelCharge, recordPayment, refundCredit, reversePayment, reverseRefund } from "../../../actions/finance";
import { changeRent, deleteTenancy, endTenancy, setDeposit, setOccupants } from "../../../actions/master-data";

export default async function TenancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await getTranslate();
  const portfolio = await loadPortfolio();
  const tenancy = portfolio.tenancy(id);
  if (!tenancy) notFound();
  const [charges, payments, balance, details, documents, refunds] = await Promise.all([
    apiGet<RentCharge[]>(`/charges?tenancyId=${id}`),
    apiGet<Payment[]>(`/payments?tenancyId=${id}`),
    apiGet<TenancyBalance>(`/tenancies/${id}/balance`),
    apiGet<OrganizationDetails>("/organization/details"),
    apiGet<DocumentInfo[]>(`/documents?tenancyId=${id}`),
    apiGet<CreditRefund[]>(`/tenancies/${id}/refunds`),
  ]);
  const openCharges = charges.filter((c) => !c.cancelled && c.openCents > 0);
  const day = today();
  const overdue = charges.filter((c) => !c.cancelled && c.openCents > 0 && c.dueDate < day);
  const overdueCents = overdue.reduce((sum, c) => sum + c.openCents, 0);
  // Two weeks is a common choice for a first reminder, not a legal deadline; the user can change it.
  const payUntil = new Date(Date.parse(`${day}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const unit = portfolio.unit(tenancy.unitId);
  const money = (cents: number) => formatMoney(cents, locale);
  const facts: [string, string][] = [
    [t("field.unit"), unit ? `${unit.propertyName} · ${unit.label}` : "–"],
    [t("field.tenants"), tenancy.personIds.map((pid) => portfolio.person(pid)).filter((p) => p !== undefined).map(personName).join(", ")],
    [t("field.startDate"), formatDate(tenancy.startDate, locale)],
    [t("field.endDate"), tenancy.endDate ? formatDate(tenancy.endDate, locale) : t("tenancies.ongoing")],
    [t("field.rentType"), t(`rentType.${tenancy.rentType}`)],
    [t("field.deposit"), tenancy.depositCents === null ? "–" : `${money(tenancy.depositCents)}${tenancy.depositHeld ? ` · ${tenancy.depositHeld}` : ""}`],
    [t("field.occupants"), tenancy.occupants === null ? "–" : String(tenancy.occupants)],
    ...RENT_COMPONENT_KINDS.map((kind): [string, string] => [t(`rentComponent.${kind}`), tenancy.rent[kind] === undefined ? "–" : money(tenancy.rent[kind]!)]),
  ];

  return (
    <>
      <p className="breadcrumb">
        <Link href="/tenancies">{t("tenancies.title")}</Link>
      </p>
      <h1>{portfolio.tenancyLabel(id)}</h1>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{money(balance.chargedCents)}</span>
          <span className="stat-label">{t("balance.charged")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{money(balance.paidCents)}</span>
          <span className="stat-label">{t("balance.paid")}</span>
        </div>
        <div className={balance.openCents > 0 ? "stat warn" : "stat"}>
          <span className="stat-value">{money(balance.openCents)}</span>
          <span className="stat-label">{t("balance.open")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{money(balance.creditCents)}</span>
          <span className="stat-label">{t("balance.credit")}</span>
        </div>
      </div>

      <section className="card">
        <h2>{t("tenancies.details")}</h2>
        <dl className="facts">
          {facts.map(([label, value]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {balance.creditCents > 0 ? (
        <section className="card callout">
          <h2>{t("credit.title")}</h2>
          <p>{t("credit.text", { amount: money(balance.creditCents) })}</p>
          {balance.openCents > 0 ? <ActionButton action={applyCredit.bind(null, id)} label={t("credit.apply")} className="primary" /> : null}
          <details>
            <summary>{t("credit.refund")}</summary>
            <Form action={refundCredit.bind(null, id, null)} submit={t("credit.refundSubmit")} className="form inline">
              <Field label={t("field.amount")}>
                <input name="amountCents" inputMode="decimal" required />
              </Field>
              <Field label={t("field.paidOn")}>
                <input name="paidOn" type="date" required defaultValue={today()} />
              </Field>
            </Form>
          </details>
        </section>
      ) : null}

      {overdue.length > 0 ? (
        <section className="card callout">
          <h2>{t("reminder.title")}</h2>
          <p>{t("reminder.overdue", { count: overdue.length, amount: money(overdueCents) })}</p>
          {details.iban ? null : (
            <p className="muted">
              {t("reminder.noIban")} <Link href="/account">{t("reminder.addIban")}</Link>
            </p>
          )}
          <form method="get" action={`/tenancies/${id}/reminder`} target="_blank" className="form inline">
            <Field label={t("reminder.payUntil")}>
              <input name="payUntil" type="date" required defaultValue={payUntil} />
            </Field>
            <div className="form-actions">
              <button type="submit">{t("reminder.open")}</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="card">
        <h2>{t("charges.title")}</h2>
        {charges.length === 0 ? (
          <p className="muted">{t("charges.emptyForTenancy")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.month")}</th>
                <th>{t("field.component")}</th>
                <th>{t("field.dueDate")}</th>
                <th className="num">{t("field.amount")}</th>
                <th className="num">{t("field.open")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className={c.cancelled ? "struck" : undefined}>
                  <td>{formatMonth(c.month, locale)}</td>
                  <td>{t(`rentComponent.${c.kind}`)}</td>
                  <td>{formatDate(c.dueDate, locale)}</td>
                  <td className="num">{money(c.amountCents)}</td>
                  <td className="num">{c.cancelled ? t("charges.cancelled") : money(c.openCents)}</td>
                  <td className="actions">
                    {!c.cancelled && c.openCents === c.amountCents ? <ActionButton action={cancelCharge.bind(null, c.id, id)} label={t("charges.cancel")} confirm={t("charges.cancelConfirm")} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>{t("payments.title")}</h2>
        {payments.length === 0 ? (
          <p className="muted">{t("payments.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.receivedOn")}</th>
                <th>{t("field.reference")}</th>
                <th className="num">{t("field.amount")}</th>
                <th className="num">{t("balance.credit")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={p.reversed ? "struck" : undefined}>
                  <td>{formatDate(p.receivedOn, locale)}</td>
                  <td>{p.reference ?? (p.bankTransactionId ? t("payments.fromBank") : "–")}</td>
                  <td className="num">{money(p.amountCents)}</td>
                  <td className="num">{money(p.unallocatedCents)}</td>
                  <td className="actions">
                    {p.reversed ? (
                      t("payments.reversed")
                    ) : (
                      <details>
                        <summary>{t("payments.reverse")}</summary>
                        <Form action={reversePayment.bind(null, p.id, id)} submit={t("payments.reverse")} className="form compact">
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
        <h3>{t("payments.new")}</h3>
        <p className="muted">{t("payments.newHint")}</p>
        <Form action={recordPayment.bind(null, id)} submit={t("payments.record")} className="form inline">
          <Field label={t("field.receivedOn")}>
            <input name="receivedOn" type="date" required defaultValue={today()} />
          </Field>
          <Field label={t("field.amount")}>
            <input name="amountCents" inputMode="decimal" required />
          </Field>
          <Field label={t("field.reference")}>
            <input name="reference" maxLength={500} />
          </Field>
          {openCharges.length > 0 ? (
            <fieldset className="field wide" data-field="allocations">
              <legend className="field-label">{t("payments.chooseCharges")}</legend>
              <div className="checks">
                {openCharges.map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" name="chargeIds" value={c.id} /> {t(`rentComponent.${c.kind}`)} {formatMonth(c.month, locale)} ({money(c.openCents)})
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </Form>
        {refunds.length > 0 ? (
          <>
            <h3>{t("credit.refunds")}</h3>
            <table>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className={r.reversed ? "struck" : undefined}>
                    <td>{formatDate(r.paidOn, locale)}</td>
                    <td>{t(`refundReason.${r.reason}`)}</td>
                    <td className="num">{money(r.amountCents)}</td>
                    <td className="actions">
                      {r.reversed ? (
                        t("payments.reversed")
                      ) : (
                        <details>
                          <summary>{t("payments.reverse")}</summary>
                          <Form action={reverseRefund.bind(null, r.id, id)} submit={t("payments.reverse")} className="form compact">
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
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>{t("documents.title")}</h2>
        <Documents documents={documents} target={{ tenancyId: id, path: `/tenancies/${id}` }} kinds={["contract", "correspondence", "other"]} locale={locale} t={t} />
      </section>

      <div className="columns">
        <details className="card">
          <summary>{t("tenancies.changeRent")}</summary>
          <Form action={changeRent.bind(null, id)} submit={t("action.save")}>
            <Field label={t("field.component")}>
              <select name="kind">
                {RENT_COMPONENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`rentComponent.${kind}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.newAmount")}>
              <input name="amountCents" inputMode="decimal" required />
            </Field>
            <Field label={t("field.validFrom")}>
              <input name="validFrom" type="date" required />
            </Field>
          </Form>
        </details>
        <details className="card">
          <summary>{t("tenancies.deposit")}</summary>
          <p className="muted small">{t("tenancies.depositHint")}</p>
          <Form action={setDeposit.bind(null, id)} submit={t("action.save")}>
            <Field label={t("field.deposit")}>
              <input name="depositCents" inputMode="decimal" defaultValue={tenancy.depositCents === null ? "" : moneyInput(tenancy.depositCents, locale)} />
            </Field>
            <Field label={t("field.depositHeld")}>
              <input name="depositHeld" maxLength={200} defaultValue={tenancy.depositHeld ?? ""} />
            </Field>
          </Form>
        </details>
        <details className="card">
          <summary>{t("tenancies.occupants")}</summary>
          <p className="muted small">{t("tenancies.occupantsHint")}</p>
          <Form action={setOccupants.bind(null, id)} submit={t("action.save")}>
            <Field label={t("field.occupants")}>
              <input name="persons" type="number" min={0} max={99} required defaultValue={tenancy.occupants ?? undefined} />
            </Field>
            <Field label={t("field.validFrom")}>
              <input name="validFrom" type="date" required defaultValue={tenancy.startDate > today() ? tenancy.startDate : today()} />
            </Field>
          </Form>
        </details>
        <details className="card">
          <summary>{t("tenancies.end")}</summary>
          <Form action={endTenancy.bind(null, id)} submit={t("tenancies.end")}>
            <Field label={t("field.lastDay")}>
              <input name="endDate" type="date" required defaultValue={tenancy.endDate ?? undefined} />
            </Field>
          </Form>
        </details>
      </div>
      {charges.length === 0 && payments.length === 0 && documents.length === 0 ? (
        <section className="card">
          <p className="muted">{t("tenancies.deleteHint")}</p>
          <ActionButton action={deleteTenancy.bind(null, id)} label={t("tenancies.delete")} confirm={t("tenancies.deleteConfirm")} />
        </section>
      ) : null}
    </>
  );
}
