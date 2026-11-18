import Link from "next/link";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { getTranslate } from "../../../lib/locale";
import { loadPortfolio } from "../../../lib/portfolio";
import { createProperty } from "../../actions/master-data";

export default async function PropertiesPage() {
  const { t } = await getTranslate();
  const portfolio = await loadPortfolio();
  return (
    <>
      <h1>{t("properties.title")}</h1>
      <section className="card">
        {portfolio.properties.length === 0 ? (
          <p className="muted">{t("properties.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("field.name")}</th>
                <th className="num">{t("properties.buildings")}</th>
                <th className="num">{t("properties.units")}</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.properties.map((p) => {
                const units = portfolio.units.filter((u) => u.propertyId === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/properties/${p.id}`}>{p.name}</Link>
                    </td>
                    <td className="num">{new Set(units.map((u) => u.building.id)).size}</td>
                    <td className="num">{units.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>{t("properties.new")}</h2>
        <Form action={createProperty} submit={t("action.create")}>
          <Field label={t("field.name")} hint={t("properties.nameHint")}>
            <input name="name" required maxLength={200} />
          </Field>
        </Form>
      </section>
    </>
  );
}
