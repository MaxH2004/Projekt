import type { Settlement } from "@hv/contracts";
import { renderTemplate } from "@hv/pdf-templates";
import { ApiFailure, apiGet } from "../../../../../../lib/api";
import { LETTER_HEADERS, loadSender, recipientOf } from "../../../../../../lib/letters";
import { getLocale } from "../../../../../../lib/locale";
import { today } from "../../../../../../lib/money";
import { loadPortfolio } from "../../../../../../lib/portfolio";

/**
 * The statement of one tenancy as a printable page in the user's language.
 * Printing to PDF happens in the browser; see docs/BACKLOG.md.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; tenancyId: string }> }): Promise<Response> {
  const { id, tenancyId } = await params;
  let settlement: Settlement;
  try {
    settlement = await apiGet<Settlement>(`/settlements/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiFailure && err.code === "not_found") return new Response(null, { status: 404 });
    throw err;
  }
  const statement = settlement.result.statements.find((s) => s.tenancyId === tenancyId);
  if (!statement) return new Response(null, { status: 404 });

  const [sender, portfolio, locale] = await Promise.all([loadSender(), loadPortfolio(), getLocale()]);
  const recipient = recipientOf(portfolio, tenancyId);

  const body = renderTemplate("operating-cost-statement", locale, {
    ...sender,
    recipientAddress: recipient.address,
    recipientName: recipient.names,
    unitLabel: recipient.unitLabel,
    letterDate: today(),
    periodFrom: settlement.from,
    periodTo: settlement.to,
    days: statement.days,
    periodDays: settlement.result.periodDays,
    lines: statement.lines.map((line) => ({
      category: line.category,
      totalCostCents: BigInt(settlement.result.costs.find((c) => c.category === line.category)?.amountCents ?? 0),
      key: line.basis.key,
      ownWeight: line.basis.ownWeight,
      totalWeight: line.basis.totalWeight,
      shareCents: BigInt(line.shareCents),
    })),
    totalCents: BigInt(statement.totalCents),
    advancesPaidCents: BigInt(statement.advancesPaidCents),
    balanceCents: BigInt(statement.balanceCents),
    dueDate: settlement.dueDate,
  });
  return new Response(body, { headers: LETTER_HEADERS });
}
