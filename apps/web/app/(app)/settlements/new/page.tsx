import { ERROR_CODES, SETTLEMENT_KEYS, type ErrorCode, type SettlementDraft, type SettlementResult } from "@hv/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field } from "../../../../components/field";
import { Form } from "../../../../components/form";
import { api, ApiFailure, apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { formatArea, formatDate, formatMoney, today } from "../../../../lib/money";
import { loadPortfolio } from "../../../../lib/portfolio";
import { configFromQuery, periodFromQuery, type SearchParams } from "../../../../lib/settlement";
import { finalizeSettlement } from "../../../actions/settlement";

export default async function NewSettlementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const period = periodFromQuery(params);
  if (!period) notFound();
  const { locale, t } = await getTranslate();
  const money = (cents: number) => formatMoney(cents, locale);

  let draft: SettlementDraft;
  try {
    draft = await apiGet<SettlementDraft>(`/settlements/draft?propertyId=${encodeURIComponent(period.propertyId)}&from=${period.from}&to=${period.to}`);
  } catch (err) {
    if (err instanceof ApiFailure && err.code !== "unauthenticated") {
      return (
        <section className="card">
          <p className="form-error">{t(`error.${err.code}`)}</p>
          <Link href="/settlements">{t("settlements.back")}</Link>
        </section>
      );
    }
    throw err;
  }
  const portfolio = await loadPortfolio();
  const property = portfolio.properties.find((p) => p.id === period.propertyId);
  const unitLabel = (id: string) => draft.units.find((u) => u.id === id)?.label ?? "–";
  const config = configFromQuery(params, period);
  const chosen = (category: string) => (params[`key_${category}`] as string | undefined) ?? "area";

  let preview: SettlementResult | null = null;
  let previewError: { code: ErrorCode; fields: readonly string[] } | null = null;
  if (params.preview === "1") {
    try {
      preview = await api<SettlementResult>("POST", "/settlements/preview", config);
    } catch (err) {
      if (!(err instanceof ApiFailure)) throw err;
      previewError = { code: (ERROR_CODES as readonly string[]).includes(err.code) ? err.code : "conflict", fields: err.fields };
    }
  }
  const invalid = new Set(previewError?.fields ?? []);

  return (
    <>
      <p className="breadcrumb">
        <Link href="/settlements">{t("settlements.title")}</Link>
      </p>
      <h1>
        {property?.name} · {formatDate(draft.from, locale)} – {formatDate(draft.to, locale)}
      </h1>

      {draft.costs.length === 0 || draft.tenancies.length === 0 ? (
        <section className="card callout">
          <p>{t("settlements.nothing")}</p>
        </section>
      ) : null}

      <form method="get" action="/settlements/new">
        <input type="hidden" name="propertyId" value={period.propertyId} />
        <input type="hidden" name="from" value={period.fromMonth} />
        <input type="hidden" name="to" value={period.toMonth} />
        <input type="hidden" name="preview" value="1" />

        <section className="card">
          <h2>{t("settlements.costs")}</h2>
          <p className="muted">{t("settlements.costsHint")}</p>
          {draft.costs.length === 0 ? (
            <p className="muted">{t("settlements.noCosts")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("field.operatingCostCategory")}</th>
                  <th className="num">{t("field.amount")}</th>
                  <th>{t("field.allocationKey")}</th>
                  <th>{t("settlements.directUnit")}</th>
                </tr>
              </thead>
              <tbody>
                {draft.costs.map((c) => (
                  <tr key={c.category}>
                    <td>{t(`category.${c.category}`)}</td>
                    <td className="num">{money(c.amountCents)}</td>
                    <td>
                      <select name={`key_${c.category}`} defaultValue={chosen(c.category)} aria-label={t("field.allocationKey")} aria-invalid={invalid.has(`keys.${c.category}`) || undefined}>
                        {SETTLEMENT_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {t(`settlementKey.${k}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        name={`unit_${c.category}`}
                        defaultValue={(params[`unit_${c.category}`] as string | undefined) ?? ""}
                        aria-label={t("settlements.directUnit")}
                        aria-invalid={invalid.has(`keys.${c.category}.directUnitId`) || undefined}
                      >
                        <option value="">–</option>
                        {draft.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {draft.excluded.length > 0 ? (
            <p className="muted">
              {t("settlements.heatingExcluded", { amount: money(draft.excluded.reduce((s, c) => s + c.amountCents, 0)) })}
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>{t("settlements.unitsAndTenancies")}</h2>
          <table>
            <thead>
              <tr>
                <th>{t("field.unit")}</th>
                <th className="num">{t("field.area")}</th>
              </tr>
            </thead>
            <tbody>
              {draft.units.map((u) => (
                <tr key={u.id}>
                  <td>{u.label}</td>
                  <td className={invalid.has(`units.${u.id}`) ? "num overdue" : "num"}>{u.areaCentiSqm === null ? t("settlements.areaMissing") : formatArea(u.areaCentiSqm, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{t("tenancies.title")}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("field.tenancy")}</th>
                <th className="num">{t("settlements.days", { periodDays: draft.periodDays })}</th>
                <th className="num">{t("settlements.advancesPaid")}</th>
                <th className="num">{t("settlements.persons")}</th>
              </tr>
            </thead>
            <tbody>
              {draft.tenancies.map((tn) => (
                <tr key={tn.id}>
                  <td>{portfolio.tenancyLabel(tn.id)}</td>
                  <td className="num">{tn.days}</td>
                  <td className="num">{money(tn.advancesPaidCents)}</td>
                  <td className="num">
                    <input
                      name={`persons_${tn.id}`}
                      type="number"
                      min={0}
                      max={99}
                      className="narrow-input"
                      defaultValue={(params[`persons_${tn.id}`] as string | undefined) ?? String(tn.tenantCount)}
                      aria-label={t("settlements.persons")}
                      aria-invalid={invalid.has(`personsByTenancy.${tn.id}`) || undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form inline">
            <Field label={t("settlements.vacancyPersons")} hint={t("settlements.vacancyPersonsHint")}>
              <input
                name="vacancyPersons"
                type="number"
                min={0}
                max={99}
                defaultValue={(params.vacancyPersons as string | undefined) ?? ""}
                aria-invalid={invalid.has("vacancyPersons") || undefined}
              />
            </Field>
          </div>
          <p className="muted">{t("settlements.advancesHint")}</p>
        </section>

        {previewError ? (
          <p className="form-error card" role="alert">
            {t(`error.${previewError.code}`)}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className={preview ? "secondary" : undefined}>
            {t("settlements.calculate")}
          </button>
        </div>
      </form>

      {preview ? (
        <>
          <section className="card">
            <h2>{t("settlements.preview")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t("field.tenancy")}</th>
                  <th className="num">{t("settlements.costShare")}</th>
                  <th className="num">{t("settlements.advancesPaid")}</th>
                  <th className="num">{t("settlements.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.statements.map((s) => (
                  <tr key={s.tenancyId}>
                    <td>
                      {portfolio.tenancyLabel(s.tenancyId)}
                      <div className="muted small">
                        {s.lines.map((l) => `${t(`category.${l.category}`)} ${money(l.shareCents)}`).join(" · ")}
                      </div>
                    </td>
                    <td className="num">{money(s.totalCents)}</td>
                    <td className="num">{money(s.advancesPaidCents)}</td>
                    <td className="num">{s.balanceCents >= 0 ? t("settlements.toPay", { amount: money(s.balanceCents) }) : t("settlements.toRefund", { amount: money(-s.balanceCents) })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t("settlements.landlordShare")}</th>
                  <td className="num">{money(preview.landlordCents)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
            <p className="muted">{t("settlements.deadline", { date: formatDate(preview.deadline, locale) })}</p>
            <p className="muted">
              {t("settlements.units")}: {draft.units.map((u) => unitLabel(u.id)).join(", ")}
            </p>
          </section>
          <section className="card callout">
            <h2>{t("settlements.finalize")}</h2>
            <p>{t("settlements.finalizeHint")}</p>
            <Form action={finalizeSettlement} submit={t("settlements.finalizeSubmit")} className="form inline">
              <input type="hidden" name="config" value={JSON.stringify(config)} />
              <Field label={t("settlements.dueDate")}>
                <input name="dueDate" type="date" required defaultValue={today()} />
              </Field>
            </Form>
          </section>
        </>
      ) : null}
    </>
  );
}
