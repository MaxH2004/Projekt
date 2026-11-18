import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let base: string;
let anna: string;
let ben: string;
let property: string;
let expense: string;

const password = "a long enough password";
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const call = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await api.request(method, path, { cookie, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const upload = (cookie: string, query: Record<string, string>, bytes: Uint8Array) =>
  fetch(`${base}/documents/upload?${new URLSearchParams(query)}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/octet-stream" },
    body: Buffer.from(bytes),
  });

beforeAll(async () => {
  api = await createTestApp();
  base = await api.app.getUrl();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
  property = (await call(anna, "POST", "/properties", { name: "P" })).body.id;
  expense = (await call(anna, "POST", "/expenses", { paidOn: "2026-03-01", paidFrom: "bank", lines: [{ accountCode: "640000", propertyId: property, amountCents: 1000 }] })).body.id;
});

afterAll(() => api.close());

describe("documents", () => {
  it("stores a receipt with the type detected from its content", async () => {
    const res = await upload(anna, { kind: "receipt", fileName: "Rechnung März.pdf", expenseId: expense }, pdf);
    expect(res.status).toBe(201);
    const doc = await res.json();
    expect(doc).toMatchObject({ kind: "receipt", fileName: "Rechnung März.pdf", contentType: "application/pdf", sizeBytes: pdf.length, expenseId: expense, deletable: false });
    expect((await call(anna, "GET", `/documents?expenseId=${expense}`)).body.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect((await call(anna, "GET", "/documents?receipts=true")).body.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect((await call(anna, "GET", "/documents")).body).toEqual({ code: "validation_failed", fields: ["propertyId"] });

    const download = await fetch(`${base}/documents/${doc.id}/content`, { headers: { cookie: anna } });
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
  });

  it("refuses files that are not PDF or images, whatever their name", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await upload(anna, { kind: "other", fileName: "invoice.pdf", propertyId: property }, html);
    expect([res.status, await res.json()]).toEqual([415, { code: "file_type_not_accepted" }]);
    expect((await upload(anna, { kind: "other", fileName: "x.pdf" }, pdf)).status).toBe(400);
  });

  it("keeps documents apart between organizations and removes the file of a refused upload", async () => {
    const foreign = await upload(ben, { kind: "contract", fileName: "c.pdf", propertyId: property }, pdf);
    expect(foreign.status).toBe(404);
    const [doc] = (await call(anna, "GET", `/documents?expenseId=${expense}`)).body;
    expect((await fetch(`${base}/documents/${doc.id}/content`, { headers: { cookie: ben } })).status).toBe(404);
    expect((await call(ben, "GET", `/documents?expenseId=${expense}`)).body).toEqual([]);
    // Only Anna's receipt is in the storage.
    const { DocumentsService } = await import("./modules/documents/index.js");
    const storage = (api.app.get(DocumentsService) as unknown as { storage: { files: Map<string, Uint8Array> } }).storage;
    expect(storage.files.size).toBe(1);
  });

  it("deletes a property document, but never the receipt of an expense", async () => {
    const contract = await (await upload(anna, { kind: "contract", fileName: "Vertrag.pdf", propertyId: property }, pdf)).json();
    expect((await call(anna, "DELETE", `/documents/${contract.id}`)).status).toBe(204);
    expect((await call(anna, "GET", `/documents?propertyId=${property}`)).body).toEqual([]);

    const [receipt] = (await call(anna, "GET", `/documents?expenseId=${expense}`)).body;
    expect(await call(anna, "DELETE", `/documents/${receipt.id}`)).toEqual({ status: 409, body: { code: "conflict" } });
  });
});
