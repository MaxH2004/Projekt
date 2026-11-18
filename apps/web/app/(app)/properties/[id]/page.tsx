import { METER_KINDS, METER_MEASURES, type Building, type DocumentInfo, type Meter, type Property, type Unit, type UnitAreaVersion } from "@hv/contracts";
import { Documents } from "../../../../components/documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field } from "../../../../components/field";
import { ActionButton, Form } from "../../../../components/form";
import { ApiFailure, apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatArea, formatDate } from "../../../../lib/money";
import { createBuilding, createMeter, createUnit, deleteMeter, renameProperty, renameUnit, setUnitArea, updateBuilding } from "../../../actions/master-data";

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
  const [units, documents, meters] = await Promise.all([
    Promise.all(buildings.map((b) => apiGet<Unit[]>(`/buildings/${b.id}/units`))),
    apiGet<DocumentInfo[]>(`/documents?propertyId=${id}`),
    apiGet<Meter[]>("/meters"),
  ]);
  const areas = new Map(
    await Promise.all(units.flat().map(async (u) => [u.id, await apiGet<UnitAreaVersion[]>(`/units/${u.id}/areas`)] as const)),
  );
  const meterList = (list: Meter[]) =>
    list.length === 0 ? null : (
      <ul className="document-list">
        {list.map((m) => (
          <li key={m.id}>
            <a href={`/meters/${m.id}`}>
              {t(`meter.kind.${m.kind}`)} · {m.serialNumber}
            </a>
            <span className="muted small">{t(`meter.measure.${m.measure}`)}</span>
            <ActionButton action={deleteMeter.bind(null, m.id, id)} label={t("action.delete")} className="link-button" confirm={t("meters.deleteConfirm")} />
          </li>
        ))}
      </ul>
    );

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
                  <th />
                </tr>
              </thead>
              <tbody>
                {units[i]!.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.label}
                      {meterList(meters.filter((m) => m.unitId === u.id))}
                    </td>
                    <td className="num">{u.areaCentiSqm === null ? "–" : formatArea(u.areaCentiSqm, locale)}</td>
                    <td className="actions">
                      <details>
                        <summary>{t("units.edit")}</summary>
                        <div className="unit-edit">
                          <h3>{t("units.areaHistory")}</h3>
                          {(areas.get(u.id) ?? []).length === 0 ? (
                            <p className="muted">{t("units.noArea")}</p>
                          ) : (
                            <ul className="document-list">
                              {(areas.get(u.id) ?? []).map((a) => (
                                <li key={a.validFrom}>
                                  {formatArea(a.areaCentiSqm, locale)}
                                  <span className="muted small">
                                    {formatDate(a.validFrom, locale)} – {a.validTo ? formatDate(a.validTo, locale) : t("units.today")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <Form action={setUnitArea.bind(null, u.id, id)} submit={t("action.save")} className="form compact">
                            <Field label={t("field.areaSqm")}>
                              <input name="area" inputMode="decimal" required data-field="areaCentiSqm" />
                            </Field>
                            <Field label={t("field.areaValidFrom")} hint={t("units.areaChangeHint")}>
                              <input name="validFrom" type="date" required />
                            </Field>
                          </Form>
                          <Form action={renameUnit.bind(null, u.id, id)} submit={t("units.rename")} className="form compact">
                            <Field label={t("field.unitLabel")}>
                              <input name="label" required maxLength={200} defaultValue={u.label} />
                            </Field>
                          </Form>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {meters.some((m) => m.buildingId === b.id) ? (
            <>
              <h3>{t("meters.building")}</h3>
              {meterList(meters.filter((m) => m.buildingId === b.id))}
            </>
          ) : null}
          <details>
            <summary>{t("buildings.edit")}</summary>
            <Form action={updateBuilding.bind(null, b.id, id)} submit={t("action.save")} className="form inline">
              <Field label={t("field.street")}>
                <input name="street" required maxLength={200} defaultValue={b.street} />
              </Field>
              <Field label={t("field.postalCode")}>
                <input name="postalCode" required maxLength={20} defaultValue={b.postalCode} />
              </Field>
              <Field label={t("field.city")}>
                <input name="city" required maxLength={200} defaultValue={b.city} />
              </Field>
            </Form>
          </details>
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
      {buildings.length > 0 ? (
        <section className="card">
          <h2>{t("meters.new")}</h2>
          <Form action={createMeter.bind(null, id)} submit={t("action.create")} className="form inline">
            <Field label={t("meters.target")}>
              <select name="target" required>
                {buildings.map((b, i) => (
                  <optgroup key={b.id} label={b.street}>
                    <option value={`building:${b.id}`}>{t("meters.wholeBuilding")}</option>
                    {units[i]!.map((u) => (
                      <option key={u.id} value={`unit:${u.id}`}>
                        {u.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label={t("meters.kind")}>
              <select name="kind">
                {METER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`meter.kind.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("meters.measure")}>
              <select name="measure">
                {METER_MEASURES.map((m) => (
                  <option key={m} value={m}>
                    {t(`meter.measure.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("meters.serialNumber")}>
              <input name="serialNumber" required maxLength={100} />
            </Field>
          </Form>
        </section>
      ) : null}
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
