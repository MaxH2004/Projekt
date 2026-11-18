import { ActionButton, Form } from "../../../components/form";
import { Field } from "../../../components/field";
import { getTranslate } from "../../../lib/locale";
import { loadPortfolio, personName } from "../../../lib/portfolio";
import { createPerson, deletePerson, updatePerson } from "../../actions/master-data";

export default async function PersonsPage() {
  const { t } = await getTranslate();
  const portfolio = await loadPortfolio();
  const inTenancy = new Set(portfolio.tenancies.flatMap((tn) => tn.personIds));
  return (
    <>
      <h1>{t("persons.title")}</h1>
      <section className="card">
        {portfolio.persons.length === 0 ? (
          <p className="muted">{t("persons.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.name")}</th>
                <th>{t("field.email")}</th>
                <th>{t("field.phone")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {portfolio.persons.map((p) => (
                <tr key={p.id}>
                  <td>{personName(p)}</td>
                  <td>{p.email ?? "–"}</td>
                  <td>{p.phone ?? "–"}</td>
                  <td className="actions">
                    <details>
                      <summary>{t("persons.edit")}</summary>
                      <Form action={updatePerson.bind(null, p.id)} submit={t("action.save")} className="form compact">
                        <Field label={t("field.personKind")}>
                          <select name="kind" defaultValue={p.kind}>
                            <option value="natural">{t("persons.kind.natural")}</option>
                            <option value="legal">{t("persons.kind.legal")}</option>
                          </select>
                        </Field>
                        <Field label={t("field.givenName")}>
                          <input name="givenName" maxLength={200} defaultValue={p.givenName ?? ""} />
                        </Field>
                        <Field label={t("field.familyName")}>
                          <input name="familyName" maxLength={200} defaultValue={p.familyName ?? ""} />
                        </Field>
                        <Field label={t("field.companyName")}>
                          <input name="companyName" maxLength={200} defaultValue={p.companyName ?? ""} />
                        </Field>
                        <Field label={t("field.email")}>
                          <input name="email" type="email" maxLength={254} defaultValue={p.email ?? ""} />
                        </Field>
                        <Field label={t("field.phone")}>
                          <input name="phone" type="tel" maxLength={50} defaultValue={p.phone ?? ""} />
                        </Field>
                      </Form>
                    </details>
                    {inTenancy.has(p.id) ? null : <ActionButton action={deletePerson.bind(null, p.id)} label={t("action.delete")} confirm={t("persons.deleteConfirm")} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>{t("persons.new")}</h2>
        <Form action={createPerson} submit={t("action.create")} className="form inline">
          <Field label={t("field.personKind")}>
            <select name="kind" defaultValue="natural">
              <option value="natural">{t("persons.kind.natural")}</option>
              <option value="legal">{t("persons.kind.legal")}</option>
            </select>
          </Field>
          <Field label={t("field.givenName")}>
            <input name="givenName" maxLength={200} />
          </Field>
          <Field label={t("field.familyName")} hint={t("persons.naturalOnly")}>
            <input name="familyName" maxLength={200} />
          </Field>
          <Field label={t("field.companyName")} hint={t("persons.legalOnly")}>
            <input name="companyName" maxLength={200} />
          </Field>
          <Field label={t("field.email")}>
            <input name="email" type="email" maxLength={254} />
          </Field>
          <Field label={t("field.phone")}>
            <input name="phone" type="tel" maxLength={50} />
          </Field>
        </Form>
      </section>
    </>
  );
}
