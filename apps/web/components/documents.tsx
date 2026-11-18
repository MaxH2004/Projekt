import { DOCUMENT_KINDS, type DocumentInfo, type DocumentKind } from "@hv/contracts";
import { deleteDocument, uploadDocument, type DocumentTarget } from "../app/actions/documents";
import { formatDate } from "../lib/money";
import type { Locale } from "@hv/contracts";
import type { Translate } from "../lib/messages";
import { Field } from "./field";
import { ActionButton, Form } from "./form";

/** Size in kB or MB for a document list. */
function size(bytes: number, locale: Locale): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** Documents of one property, tenancy or expense, with download, delete and upload. */
export function Documents({
  documents,
  target,
  kinds = DOCUMENT_KINDS,
  locale,
  t,
}: {
  documents: readonly DocumentInfo[];
  target: DocumentTarget;
  kinds?: readonly DocumentKind[];
  locale: Locale;
  t: Translate;
}) {
  return (
    <div className="documents">
      {documents.length === 0 ? (
        <p className="muted">{t("documents.empty")}</p>
      ) : (
        <ul className="document-list">
          {documents.map((d) => (
            <li key={d.id}>
              <a href={`/documents/${d.id}`}>{d.fileName}</a>
              <span className="muted small">
                {t(`documentKind.${d.kind}`)} · {formatDate(d.uploadedAt.slice(0, 10), locale)} · {size(d.sizeBytes, locale)}
              </span>
              {d.deletable ? <ActionButton action={deleteDocument.bind(null, d.id, target.path)} label={t("action.delete")} className="link-button" /> : null}
            </li>
          ))}
        </ul>
      )}
      <Form action={uploadDocument.bind(null, target)} submit={t("documents.upload")} className="form inline">
        <Field label={t("documents.file")} hint={t("documents.fileHint")}>
          <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" />
        </Field>
        {kinds.length > 1 ? (
          <Field label={t("documents.kind")}>
            <select name="kind" defaultValue={kinds[0]}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`documentKind.${k}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <input type="hidden" name="kind" value={kinds[0]} />
        )}
      </Form>
    </div>
  );
}
