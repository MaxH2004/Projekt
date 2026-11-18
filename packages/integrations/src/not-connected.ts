/**
 * Thrown by a provider that is prepared in code but has no contract and no
 * access yet. Nothing is sent and no data is made up.
 */
export class IntegrationNotConnectedError extends Error {
  constructor(
    readonly integration: "bank" | "email" | "document-extraction" | "subscription-billing" | "file-storage",
    readonly kind: string,
  ) {
    super(`Integration "${integration}" with provider "${kind}" is prepared but not connected`);
    this.name = "IntegrationNotConnectedError";
  }
}
