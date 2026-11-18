import type { AuditEntry, MeResponse } from "@hv/contracts";
import Link from "next/link";
import { apiGet } from "../../../../lib/api";
import { getTranslate } from "../../../../lib/locale";
import { isMessageKey } from "../../../../lib/messages";
import { FORMAT_LOCALE } from "@hv/contracts";

const PAGE_SIZE = 100;

/** Field names whose value differs between the old and the new row. */
function changedFields(entry: AuditEntry): string[] {
  if (!entry.oldRow || !entry.newRow) return [];
  return Object.keys(entry.newRow).filter((key) => JSON.stringify(entry.oldRow![key]) !== JSON.stringify(entry.newRow![key]));
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { locale, t } = await getTranslate();
  const before = (await searchParams).before;
  const query = before && /^\d+$/.test(before) ? `&before=${before}` : "";
  const [me, entries] = await Promise.all([apiGet<MeResponse>("/auth/me"), apiGet<AuditEntry[]>(`/organization/audit-log?limit=${PAGE_SIZE}${query}`)]);
  const time = new Intl.DateTimeFormat(FORMAT_LOCALE[locale], { dateStyle: "medium", timeStyle: "medium" });
  const tableName = (table: string) => {
    const key = `audit.table.${table}`;
    return isMessageKey(key) ? t(key) : table;
  };
  return (
    <>
      <p className="breadcrumb">
        <Link href="/account">{t("account.title")}</Link>
      </p>
      <h1>{t("audit.title")}</h1>
      <p className="muted">{t("audit.hint")}</p>
      <section className="card">
        {entries.length === 0 ? (
          <p className="muted">{t("audit.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("audit.when")}</th>
                <th>{t("audit.who")}</th>
                <th>{t("audit.what")}</th>
                <th>{t("audit.changed")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{time.format(new Date(e.at))}</td>
                  <td>{e.userId === null ? t("audit.system") : e.userId === me.userId ? me.email : e.userId.slice(0, 8)}</td>
                  <td>
                    {tableName(e.table)} · {t(`audit.action.${e.action}`)}
                  </td>
                  <td className="muted small">{changedFields(e).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {entries.length === PAGE_SIZE ? (
          <p>
            <Link href={`/account/audit?before=${entries[entries.length - 1]!.id}`}>{t("audit.older")}</Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
