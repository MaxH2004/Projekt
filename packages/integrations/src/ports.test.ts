import { describe, expect, it } from "vitest";
import {
  createDocumentExtractor,
  createEmailSender,
  createSubscriptionBilling,
  EMPTY_INVOICE_EXTRACTION,
  ExternalIncomingEmailParser,
  FakeDocumentExtractor,
  FakeEmailSender,
  FakeSubscriptionBilling,
  IntegrationNotConnectedError,
  type IncomingEmailParser,
  type InvoiceExtraction,
} from "./index.js";

const file = { filename: "invoice.pdf", contentType: "application/pdf", content: new Uint8Array([1, 2, 3]) };
const checkout = {
  organizationId: "org-1",
  planId: "basic",
  customerEmail: "anna@example.com",
  quantity: 3,
  successUrl: "https://app.example/ok",
  cancelUrl: "https://app.example/cancel",
};

describe("providers that are prepared but not connected", () => {
  it("reject every call and name the integration", async () => {
    const incoming: IncomingEmailParser = new ExternalIncomingEmailParser();
    const calls: [string, Promise<unknown>][] = [
      ["email", createEmailSender("external")!.send({ to: "a@example.com", subject: "s", text: "t" })],
      ["email", incoming.parseWebhook(new Uint8Array(), {})],
      ["document-extraction", createDocumentExtractor("external")!.extractInvoice(file)],
      ["subscription-billing", createSubscriptionBilling("external")!.createCheckout(checkout)],
      ["subscription-billing", createSubscriptionBilling("external")!.getSubscription("org-1")],
      ["subscription-billing", createSubscriptionBilling("external")!.cancel("org-1")],
      ["subscription-billing", createSubscriptionBilling("external")!.parseWebhook(new Uint8Array(), {})],
    ];
    for (const [integration, call] of calls) {
      const error = await call.then(
        () => null,
        (err: unknown) => err,
      );
      expect(error, integration).toBeInstanceOf(IntegrationNotConnectedError);
      expect((error as IntegrationNotConnectedError).integration).toBe(integration);
    }
  });
});

describe("configuration", () => {
  it("switches each integration off with none and rejects unknown kinds", () => {
    for (const create of [createEmailSender, createDocumentExtractor, createSubscriptionBilling]) {
      expect(create("none")).toBeNull();
      expect(create("fake")?.kind).toBe("fake");
      expect(create("external")?.kind).toBe("external");
      expect(() => create("some-vendor")).toThrow(RangeError);
    }
  });
});

describe("fake e-mail sender", () => {
  it("keeps what was sent, in order", async () => {
    const sender = new FakeEmailSender();
    const first = await sender.send({ to: "a@example.com", subject: "One", text: "1" });
    const second = await sender.send({ to: "b@example.com", subject: "Two", text: "2", attachments: [file] });
    expect([first.providerMessageId, second.providerMessageId]).toEqual(["fake-1", "fake-2"]);
    expect(sender.sent.map((m) => m.subject)).toEqual(["One", "Two"]);
    expect(sender.sent[1]!.attachments?.[0]?.filename).toBe("invoice.pdf");
  });
});

describe("fake document extractor", () => {
  it("returns the prepared result, otherwise an empty extraction", async () => {
    const prepared: InvoiceExtraction = {
      ...EMPTY_INVOICE_EXTRACTION,
      totalCents: { value: 12_345n, confidence: 0.9 },
      supplierName: { value: "City Utilities", confidence: 0.8 },
    };
    const extractor = new FakeDocumentExtractor({ "invoice.pdf": prepared });
    expect(await extractor.extractInvoice(file)).toBe(prepared);
    const unknown = await extractor.extractInvoice({ ...file, filename: "other.pdf" });
    expect(Object.values(unknown).every((field) => field.value === null && field.confidence === 0)).toBe(true);
  });
});

describe("fake subscription billing", () => {
  it("activates on checkout and cancels at the end of the period", async () => {
    const billing = new FakeSubscriptionBilling();
    expect(await billing.getSubscription("org-1")).toBeNull();
    expect((await billing.createCheckout(checkout)).url).toBe(checkout.successUrl);
    expect(await billing.getSubscription("org-1")).toMatchObject({ planId: "basic", status: "active", cancelAtPeriodEnd: false });
    expect(await billing.cancel("org-1")).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(await billing.getSubscription("org-2")).toBeNull();
  });

  it("rejects an invalid quantity and cancelling without a subscription", async () => {
    const billing = new FakeSubscriptionBilling();
    await expect(billing.createCheckout({ ...checkout, quantity: 0 })).rejects.toThrow(RangeError);
    await expect(billing.cancel("org-1")).rejects.toThrow(/No subscription/);
  });
});
