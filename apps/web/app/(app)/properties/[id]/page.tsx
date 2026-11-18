import type { Building, DocumentInfo, Property, Unit } from "@hv/contracts";
import { Documents } from "../../../../components/documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field } from "../../../../components/field";
import { Form } from "../../../../components/form";
import { ApiFailure, apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatArea } from "../../../../lib/money";
import { createBuilding, createUnit, renameProperty } from "../../../actions/master-data";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await getTranslate();
  let property: Property | undefined;
  try {
    property = (await apiGet<Property[]>("/properties")).find((p) => p.id === id);
  } catch (err) {
    if (!(err instanceof ApiFailure)) throw err;
  }
  if (!property) notFound();
  const buildings = await apiGet<Building[]>(`/properties/${id}/buildings`);
  const [units, documents] = await Promise.all([
    Promise.all(buildings.map((b) => apiGet<Unit[]>(`/buildings/${b.id}/units`))),
    apiGet<DocumentInfo[]>(`/documents?propertyId=${id}`),
  ]);

  return (
    <>
      <p className="breadcrumb">
        <Link href="/properties">{t("properties.title")}</Link>
      </p>
      <h1>{property.name}</h1>
      {buildings.map((b, i) => (
        <section className="card" key={b.id}>
          <h2>
            {b.street}, {b.postalCode} {b.city}
          </h2>
          {units[i]!.length === 0 ? (
            <p className="muted">{t("units.empty")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("field.unitLabel")}</th>
                  <th className="num">{t("field.area")}</th>
                </tr>
              </thead>
              <tbody>
                {units[i]!.map((u) => (
                  <tr key={u.id}>
                    <td>{u.label}</td>
                    <td className="num">{u.areaCentiSqm === null ? "–" : formatArea(u.areaCentiSqm, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary>{t("units.new")}</summary>
            <Form action={createUnit.bind(null, id, b.id)} submit={t("action.create")} className="form inline">
              <Field label={t("field.unitLabel")} hint={t("units.labelHint")}>
                <input name="label" required maxLength={200} />
              </Field>
              <Field label={t("field.areaSqm")}>
                <input name="area" inputMode="decimal" data-field="area.areaCentiSqm" />
              </Field>
              <Field label={t("field.areaValidFrom")} hint={t("units.areaValidFromHint")}>
                <input name="areaValidFrom" type="date" data-field="area.validFrom" />
              </Field>
            </Form>
          </details>
        </section>
      ))}
      <section className="card">
        <h2>{t("buildings.new")}</h2>
        {buildings.length === 0 ? <p className="muted">{t("buildings.empty")}</p> : null}
        <Form action={createBuilding.bind(null, id)} submit={t("action.create")} className="form inline">
          <Field label={t("field.street")}>
            <input name="street" required maxLength={200} />
          </Field>
          <Field label={t("field.postalCode")}>
            <input name="postalCode" required maxLength={20} />
          </Field>
          <Field label={t("field.city")}>
            <input name="city" required maxLength={200} />
          </Field>
        </Form>
      </section>
      <section className="card">
        <h2>{t("documents.title")}</h2>
        <Documents documents={documents} target={{ propertyId: id, path: `/properties/${id}` }} kinds={["contract", "correspondence", "other"]} locale={locale} t={t} />
      </section>
      <details className="card">
        <summary>{t("properties.rename")}</summary>
        <Form action={renameProperty.bind(null, id)} submit={t("action.save")}>
          <Field label={t("field.name")}>
            <input name="name" required maxLength={200} defaultValue={property.name} />
          </Field>
        </Form>
      </details>
    </>
  );
}
