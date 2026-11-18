import { apiRequest } from "../../../../lib/api";

/** All data of the organization as one JSON file, as a download. */
export async function GET(): Promise<Response> {
  const res = await apiRequest("GET", "/organization/export");
  if (!res.ok) return new Response(null, { status: res.status === 401 ? 401 : 500 });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(res.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="hausverwaltung-export-${day}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
