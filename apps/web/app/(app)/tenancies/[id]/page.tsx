import { RENT_COMPONENT_KINDS, type Payment, type RentCharge, type TenancyBalance } from "@hv/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field } from "../../../../components/field";
import { ActionButton, Form } from "../../../../components/form";
import { apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatDate, formatMonth, formatMoney, today } from "../../../../lib/money";
import { loadPortfolio, personName } from "../../../../lib/portfolio";
import { cancelCharge, recordPayment, reversePayment } from "../../../actions/finance";
import { changeRent, endTenancy } from "../../../actions/master-data";

export default async function TenancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await getTranslate();
  const portfolio = await loadPortfolio();
  const tenancy = portfolio.tenancy(id);
  if (!tenancy) notFound();
  const [charges, payments, balance] = await Promise.all([
    apiGet<RentCharge[]>(`/charges?tenancyId=${id}`),
    apiGet<Payment[]>(`/payments?tenancyId=${id}`),
    apiGet<TenancyBalance>(`/tenancies/${id}/balance`),
  ]);
  const unit = portfolio.unit(tenancy.unitId);
  const money = (cents: number) => formatMoney(cents, locale);
  const facts: [string, string][] = [
    [t("field.unit"), unit ? `${unit.propertyName} · ${unit.label}` : "–"],
    [t("field.tenants"), tenancy.personIds.map((pid) => portfolio.person(pid)).filter((p) => p !== undefined).map(personName).join(", ")],
    [t("field.startDate"), formatDate(tenancy.startDate, locale)],
    [t("field.endDate"), tenancy.endDate ? formatDate(tenancy.endDate, locale) : t("tenancies.ongoing")],
    [t("field.rentType"), t(`rentType.${tenancy.rentType}`)],
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
                    {!c.cancelled && c.openCents === c.amountCents ? <ActionButton action={cancelCharge.bind(null, c.id, id)} label={t("charges.cancel")} /> : null}
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
        </Form>
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
          <summary>{t("tenancies.end")}</summary>
          <Form action={endTenancy.bind(null, id)} submit={t("tenancies.end")}>
            <Field label={t("field.lastDay")}>
              <input name="endDate" type="date" required defaultValue={tenancy.endDate ?? undefined} />
            </Field>
          </Form>
        </details>
      </div>
    </>
  );
}
