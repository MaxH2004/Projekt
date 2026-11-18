import { FORMAT_LOCALE, type Meter, type MeterReading } from "@hv/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field } from "../../../../components/field";
import { ActionButton, Form } from "../../../../components/form";
import { apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatDate, today } from "../../../../lib/money";
import { loadPortfolio } from "../../../../lib/portfolio";
import { addReading, deleteReading } from "../../../actions/master-data";

export default async function MeterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await getTranslate();
  const [meters, portfolio] = await Promise.all([apiGet<Meter[]>("/meters"), loadPortfolio()]);
  const meter = meters.find((m) => m.id === id);
  if (!meter) notFound();
  const readings = await apiGet<MeterReading[]>(`/meters/${id}/readings`);
  const unit = meter.unitId ? portfolio.unit(meter.unitId) : undefined;
  const building = unit?.building ?? portfolio.units.find((u) => u.building.id === meter.buildingId)?.building;
  const propertyId = unit?.propertyId ?? portfolio.units.find((u) => u.building.id === meter.buildingId)?.propertyId;
  const number = new Intl.NumberFormat(FORMAT_LOCALE[locale], { maximumFractionDigits: 3 });

  return (
    <>
      <p className="breadcrumb">{propertyId ? <Link href={`/properties/${propertyId}`}>{portfolio.properties.find((p) => p.id === propertyId)?.name}</Link> : null}</p>
      <h1>
        {t(`meter.kind.${meter.kind}`)} · {meter.serialNumber}
      </h1>
      <p className="muted">
        {unit ? `${building?.street ?? ""} · ${unit.label}` : `${building?.street ?? ""} · ${t("meters.wholeBuilding")}`} · {t(`meter.measure.${meter.measure}`)}
      </p>
      <section className="card">
        <h2>{t("meters.readings")}</h2>
        {readings.length === 0 ? (
          <p className="muted">{t("meters.noReadings")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("meters.readingDate")}</th>
                <th className="num">{t("meters.value")}</th>
                <th className="num">{t("meters.consumption")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => {
                const previous = readings[i - 1];
                // Decimal strings with up to three places; scaled to whole thousandths to subtract exactly.
                const thousandths = (v: string) => Math.round(Number(v) * 1000);
                const used = previous ? (thousandths(r.value) - thousandths(previous.value)) / 1000 : null;
                return (
                  <tr key={r.id}>
                    <td>{formatDate(r.readingDate, locale)}</td>
                    <td className="num">{number.format(Number(r.value))}</td>
                    <td className="num">{used === null ? "–" : number.format(used)}</td>
                    <td className="actions">
                      <ActionButton action={deleteReading.bind(null, r.id, id)} label={t("action.delete")} className="link-button" confirm={t("meters.deleteReadingConfirm")} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <h3>{t("meters.newReading")}</h3>
        <Form action={addReading.bind(null, id)} submit={t("action.save")} className="form inline">
          <Field label={t("meters.readingDate")}>
            <input name="readingDate" type="date" required defaultValue={today()} />
          </Field>
          <Field label={t("meters.value")} hint={t("meters.valueHint")}>
            <input name="value" inputMode="decimal" required />
          </Field>
        </Form>
      </section>
    </>
  );
}
