import { isoDateSchema, type RentCharge } from "@hv/contracts";
import { renderTemplate } from "@hv/pdf-templates";
import { apiGet } from "../../../../../lib/api";
import { LETTER_HEADERS, loadSender, recipientOf } from "../../../../../lib/letters";
import { getTranslate } from "../../../../../lib/locale";
import { formatMonth, today } from "../../../../../lib/money";
import { loadPortfolio } from "../../../../../lib/portfolio";

/**
 * Payment reminder for the overdue open charges of a tenancy, as a printable
 * page. `payUntil` is the date the tenant is asked to pay by.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const payUntil = isoDateSchema.safeParse(new URL(request.url).searchParams.get("payUntil")).data;
  if (!payUntil) return new Response(null, { status: 400 });

  const portfolio = await loadPortfolio();
  if (!portfolio.tenancy(id)) return new Response(null, { status: 404 });
  const day = today();
  const overdue = (await apiGet<RentCharge[]>(`/charges?tenancyId=${encodeURIComponent(id)}&status=open`)).filter((c) => c.dueDate < day);
  if (overdue.length === 0) return new Response(null, { status: 404 });

  const [sender, { locale, t }] = await Promise.all([loadSender(), getTranslate()]);
  const recipient = recipientOf(portfolio, id);
  const body = renderTemplate("payment-reminder", locale, {
    ...sender,
    recipientAddress: recipient.address,
    recipientName: recipient.names,
    unitLabel: recipient.unitLabel,
    letterDate: day,
    payUntil,
    items: overdue.map((c) => ({
      dueDate: c.dueDate,
      description: `${t(`rentComponent.${c.kind}`)} ${formatMonth(c.month, locale)}`,
      amountCents: BigInt(c.openCents),
    })),
  });
  return new Response(body, { headers: LETTER_HEADERS });
}
