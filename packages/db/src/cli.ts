import pg from "pg";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ist nicht gesetzt");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await migrate(client);
  console.log(applied.length ? `Angewendet: ${applied.join(", ")}` : "Datenbank ist aktuell");
} finally {
  await client.end();
}
