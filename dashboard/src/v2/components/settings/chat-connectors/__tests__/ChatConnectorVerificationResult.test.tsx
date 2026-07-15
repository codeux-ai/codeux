/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatProviderVerificationOutcome } from "../../../../../types.js";
import { ChatConnectorVerificationResult } from "../ChatConnectorVerificationResult.js";

const outcome = (overrides: Partial<ChatProviderVerificationOutcome> = {}): ChatProviderVerificationOutcome => ({
  providerConnectionId: "connection-1", providerKind: "slack", status: "verified", verifiedAt: "2026-07-14T00:00:00.000Z",
  capabilities: ["authentication"], providerErrorCode: null, retryable: false, issues: [], diagnostics: null,
  setupGuidance: { providerKind: "slack", bridgeMode: "official_api", requiredSetupFields: [], requiredSecretFields: [], capabilities: [], liveVerificationAvailable: true },
  ...overrides,
});

describe("ChatConnectorVerificationResult", () => {
  afterEach(cleanup);
  it("announces verification success politely through a named result region", () => {
    render(<ChatConnectorVerificationResult connectionName="Slack" status="verified" verifiedAt="2026-07-14" outcome={outcome()} stale={false} pending={false} />);
    expect(screen.getByRole("region", { name: "Slack verification result" })).not.toBeNull();
    expect(screen.getByText("Verified")).not.toBeNull();
  });
  it("shows redacted timeout failure and retry guidance", () => {
    render(<ChatConnectorVerificationResult connectionName="Slack" status="failed" verifiedAt={null} outcome={outcome({ status: "failed", providerErrorCode: "verification_timeout", retryable: true, issues: ["token=private-value timed out"] })} stale={false} pending={false} />);
    expect(screen.getByText("Verification failed")).not.toBeNull();
    expect(document.body.textContent).not.toContain("private-value");
    expect(screen.getByText(/marked this failure retryable/)).not.toBeNull();
  });
});
