import type { RentCharge } from "@hv/contracts";
import Link from "next/link";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { formatDate, formatMonth, formatMoney, today } from "../../../lib/money";
import { loadPortfolio } from "../../../lib/portfolio";
import { generateCharges } from "../../actions/finance";

export default async function RentPage() {
  const { locale, t } = await getTranslate();
  const [portfolio, open] = await Promise.all([loadPortfolio(), apiGet<RentCharge[]>("/charges?status=open")]);
  const day = today();
  const total = open.reduce((s, c) => s + c.openCents, 0);
  return (
    <>
      <h1>{t("rent.title")}</h1>
      <section className="card">
        <h2>{t("rent.generate")}</h2>
        <p className="muted">{t("rent.generateHint")}</p>
        <Form action={generateCharges} submit={t("rent.generateSubmit")} className="form inline">
          <Field label={t("field.month")}>
            <input name="month" type="month" required defaultValue={day.slice(0, 7)} />
          </Field>
        </Form>
      </section>
      <section className="card">
        <h2>
          {t("rent.openItems")} <span className="muted">{formatMoney(total, locale)}</span>
        </h2>
        {open.length === 0 ? (
          <p className="muted">{t("rent.noOpenItems")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.tenancy")}</th>
                <th>{t("field.month")}</th>
                <th>{t("field.component")}</th>
                <th>{t("field.dueDate")}</th>
                <th className="num">{t("field.open")}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((c) => (
                <tr key={c.id} className={c.dueDate <= day ? "overdue" : undefined}>
                  <td>
                    <Link href={`/tenancies/${c.tenancyId}`}>{portfolio.tenancyLabel(c.tenancyId)}</Link>
                  </td>
                  <td>{formatMonth(c.month, locale)}</td>
                  <td>{t(`rentComponent.${c.kind}`)}</td>
                  <td>{formatDate(c.dueDate, locale)}</td>
                  <td className="num">{formatMoney(c.openCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
