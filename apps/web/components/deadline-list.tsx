import type { Deadline, Locale } from "@hv/contracts";
import Link from "next/link";
import type { Translate } from "../lib/messages";
import { formatDate, formatMoney, today } from "../lib/money";
import type { Portfolio } from "../lib/portfolio";

/** Deadlines as a list; past ones are marked. */
export function DeadlineList({ deadlines, portfolio, locale, t }: { deadlines: readonly Deadline[]; portfolio: Portfolio; locale: Locale; t: Translate }) {
  const day = today();
  const property = (id: string) => portfolio.properties.find((p) => p.id === id)?.name ?? "–";
  return (
    <table>
      <tbody>
        {deadlines.map((d, i) => (
          <tr key={i} className={d.date < day ? "overdue" : undefined}>
            <td className="num">{formatDate(d.date, locale)}</td>
            <td>
              {d.kind === "settlement_due" ? (
                <Link href="/settlements">{t("deadlines.settlementDue", { property: property(d.propertyId), year: d.year })}</Link>
              ) : d.kind === "tenancy_end" ? (
                <Link href={`/tenancies/${d.tenancyId}`}>{t("deadlines.tenancyEnd", { tenancy: portfolio.tenancyLabel(d.tenancyId) })}</Link>
              ) : (
                <Link href={`/tenancies/${d.tenancyId}`}>
                  {t("deadlines.rentChange", {
                    tenancy: portfolio.tenancyLabel(d.tenancyId),
                    component: t(`rentComponent.${d.component}`),
                    amount: formatMoney(d.amountCents, locale),
                  })}
                </Link>
              )}
              {d.date < day ? <span className="badge">{t("deadlines.passed")}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
