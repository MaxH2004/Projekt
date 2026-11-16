/**
 * Port for billing our own customers for their subscription. The payment
 * provider holds the payment data; we only keep its ids and the state.
 * This is not about rent payments.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionState {
  readonly organizationId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  /** Day up to which the current payment covers access. */
  readonly paidUntil: string | null;
  /** True once the customer has cancelled; access continues until `paidUntil`. */
  readonly cancelAtPeriodEnd: boolean;
}

export interface CheckoutRequest {
  readonly organizationId: string;
  readonly planId: string;
  readonly customerEmail: string;
  /** Number of units, for plans priced per unit. */
  readonly quantity: number;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/** A state change reported by the provider's webhook. */
export interface SubscriptionEvent {
  /** Provider's event id; events can arrive more than once and must be applied once. */
  readonly providerEventId: string;
  readonly state: SubscriptionState;
}

export interface SubscriptionBilling {
  readonly kind: string;
  /** Returns the provider-hosted page where the customer enters payment data. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>;
  getSubscription(organizationId: string): Promise<SubscriptionState | null>;
  /** Cancels at the end of the paid period. */
  cancel(organizationId: string): Promise<SubscriptionState>;
  /**
   * Verifies and parses a webhook call. Must reject calls whose signature
   * does not match, so nobody can fake a payment.
   */
  parseWebhook(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<SubscriptionEvent>;
}
