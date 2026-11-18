import { RENT_TYPES } from "@hv/contracts";
import Link from "next/link";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { getTranslate } from "../../../lib/locale";
import { formatDate, formatMoney, today } from "../../../lib/money";
import { loadPortfolio, personName } from "../../../lib/portfolio";
import { createTenancy } from "../../actions/master-data";

export default async function TenanciesPage() {
  const { locale, t } = await getTranslate();
  const portfolio = await loadPortfolio();
  const monthly = (rent: Partial<Record<string, number>>) => Object.values(rent).reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <>
      <h1>{t("tenancies.title")}</h1>
      <section className="card">
        {portfolio.tenancies.length === 0 ? (
          <p className="muted">{t("tenancies.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.tenancy")}</th>
                <th>{t("field.startDate")}</th>
                <th>{t("field.endDate")}</th>
                <th className="num">{t("tenancies.monthlyToday")}</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.tenancies.map((tn) => (
                <tr key={tn.id}>
                  <td>
                    <Link href={`/tenancies/${tn.id}`}>{portfolio.tenancyLabel(tn.id)}</Link>
                  </td>
                  <td>{formatDate(tn.startDate, locale)}</td>
                  <td>{tn.endDate ? formatDate(tn.endDate, locale) : t("tenancies.ongoing")}</td>
                  <td className="num">{formatMoney(monthly(tn.rent), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>{t("tenancies.new")}</h2>
        {portfolio.units.length === 0 || portfolio.persons.length === 0 ? (
          <p className="muted">{t("tenancies.prerequisites")}</p>
        ) : (
          <Form action={createTenancy} submit={t("action.create")} className="form inline">
            <Field label={t("field.unit")}>
              <select name="unitId" required>
                {portfolio.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.propertyName} · {u.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.rentType")}>
              <select name="rentType" defaultValue="fixed">
                {RENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`rentType.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.startDate")}>
              <input name="startDate" type="date" required defaultValue={today()} />
            </Field>
            <Field label={t("field.endDate")} hint={t("tenancies.endHint")}>
              <input name="endDate" type="date" />
            </Field>
            <Field label={t("rentComponent.base_rent")}>
              <input name="baseRentCents" inputMode="decimal" required />
            </Field>
            <Field label={t("rentComponent.operating_cost_advance")}>
              <input name="operatingCostAdvanceCents" inputMode="decimal" />
            </Field>
            <Field label={t("rentComponent.heating_cost_advance")}>
              <input name="heatingCostAdvanceCents" inputMode="decimal" />
            </Field>
            <fieldset className="field wide" data-field="personIds">
              <legend className="field-label">{t("field.tenants")}</legend>
              <div className="checks">
                {portfolio.persons.map((p) => (
                  <label key={p.id} className="check">
                    <input type="checkbox" name="personIds" value={p.id} /> {personName(p)}
                  </label>
                ))}
              </div>
            </fieldset>
          </Form>
        )}
      </section>
    </>
  );
}
