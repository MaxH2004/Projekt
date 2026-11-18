import Link from "next/link";
import { getTranslate } from "../lib/locale";

export default async function NotFound() {
  const { t } = await getTranslate();
  return (
    <main className="public-main">
      <section className="card narrow">
        <h1>{t("notFound.title")}</h1>
        <Link href="/">{t("notFound.back")}</Link>
      </section>
    </main>
  );
}
