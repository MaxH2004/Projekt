import { IntegrationNotConnectedError } from "../not-connected.js";
import type { CheckoutRequest, SubscriptionBilling, SubscriptionEvent, SubscriptionState } from "./port.js";

/** Placeholder for the payment provider still to be chosen. Charges nobody. */
export class ExternalSubscriptionBilling implements SubscriptionBilling {
  readonly kind = "external";

  private notConnected<T>(): Promise<T> {
    return Promise.reject(new IntegrationNotConnectedError("subscription-billing", this.kind));
  }

  createCheckout(): Promise<{ url: string }> {
    return this.notConnected();
  }
  getSubscription(): Promise<SubscriptionState | null> {
    return this.notConnected();
  }
  cancel(): Promise<SubscriptionState> {
    return this.notConnected();
  }
  parseWebhook(): Promise<SubscriptionEvent> {
    return this.notConnected();
  }
}

/** Keeps subscriptions in memory, for tests and local development. A checkout activates at once. */
export class FakeSubscriptionBilling implements SubscriptionBilling {
  readonly kind = "fake";
  private readonly subscriptions = new Map<string, SubscriptionState>();

  async createCheckout(request: CheckoutRequest): Promise<{ url: string }> {
    if (!Number.isInteger(request.quantity) || request.quantity < 1) throw new RangeError("quantity must be a whole number of 1 or more");
    this.subscriptions.set(request.organizationId, {
      organizationId: request.organizationId,
      planId: request.planId,
      status: "active",
      paidUntil: null,
      cancelAtPeriodEnd: false,
    });
    return { url: request.successUrl };
  }

  async getSubscription(organizationId: string): Promise<SubscriptionState | null> {
    return this.subscriptions.get(organizationId) ?? null;
  }

  async cancel(organizationId: string): Promise<SubscriptionState> {
    const current = this.subscriptions.get(organizationId);
    if (!current) throw new Error(`No subscription for organization ${organizationId}`);
    const next = { ...current, cancelAtPeriodEnd: true };
    this.subscriptions.set(organizationId, next);
    return next;
  }

  parseWebhook(): Promise<SubscriptionEvent> {
    return Promise.reject(new Error("The fake provider sends no webhooks"));
  }
}

export type SubscriptionBillingProviderKind = "none" | "fake" | "external";

/** Picks the provider by configuration (SUBSCRIPTION_BILLING_PROVIDER). `none` = no paid plans. */
export function createSubscriptionBilling(kind: string): SubscriptionBilling | null {
  switch (kind) {
    case "none":
      return null;
    case "fake":
      return new FakeSubscriptionBilling();
    case "external":
      return new ExternalSubscriptionBilling();
    default:
      throw new RangeError(`Unknown SUBSCRIPTION_BILLING_PROVIDER: ${kind}`);
  }
}
