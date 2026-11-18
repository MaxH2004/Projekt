"use client";

import { isLocale } from "@hv/contracts";
import { createTranslate } from "../lib/messages";

/** Shown when a page fails unexpectedly. Texts come from the catalog of the page's language. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const lang = typeof document === "undefined" ? "de" : document.documentElement.lang;
  const t = createTranslate(isLocale(lang) ? lang : "de");
  return (
    <section className="card narrow">
      <h1>{t("failure.title")}</h1>
      <p>{t("failure.text")}</p>
      <button type="button" onClick={reset}>
        {t("failure.retry")}
      </button>
    </section>
  );
}
