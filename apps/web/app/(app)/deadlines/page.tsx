import type { Deadline } from "@hv/contracts";
import { DeadlineList } from "../../../components/deadline-list";
import { apiGet } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { loadPortfolio } from "../../../lib/portfolio";

export default async function DeadlinesPage() {
  const { locale, t } = await getTranslate();
  const [deadlines, portfolio] = await Promise.all([apiGet<Deadline[]>("/deadlines"), loadPortfolio()]);
  return (
    <>
      <h1>{t("deadlines.title")}</h1>
      <p className="muted">{t("deadlines.hint")}</p>
      <section className="card">{deadlines.length === 0 ? <p className="muted">{t("deadlines.empty")}</p> : <DeadlineList deadlines={deadlines} portfolio={portfolio} locale={locale} t={t} />}</section>
    </>
  );
}
