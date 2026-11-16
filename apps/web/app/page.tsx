import { getTranslate } from "../lib/locale";

export default async function HomePage() {
  const { t } = await getTranslate();
  return (
    <main>
      <h1>{t("app.name")}</h1>
      <p>{t("home.intro")}</p>
    </main>
  );
}
