import { describe, expect, it } from "vitest";
import { resolveProviderRetryDecision } from "../../../src/shared/providers/provider-retry-policy.js";
import type { ProviderErrorClassification } from "../../../src/shared/providers/provider-error-classifier.js";

const workflowSettings = {
  retryOnQuotaReset: true,
  retryOnRateLimit: true,
  rateLimitRetryDelaySeconds: 10,
};

const buildQuotaClassification = (resetAtIso: string | null): ProviderErrorClassification => ({
  category: "QUOTA_EXHAUSTED",
  provider: "codex",
  userMessage: "Codex quota exhausted.",
  resetAfter: null,
  resetAtIso,
});

describe("resolveProviderRetryDecision", () => {
  it("waits until an exact quota reset timestamp", () => {
    const nowMs = new Date("2026-06-02T10:00:00.000Z").getTime();
    const decision = resolveProviderRetryDecision(
      buildQuotaClassification("2026-06-02T11:30:00.000Z"),
      workflowSettings,
      nowMs,
    );

    expect(decision).toEqual({
      kind: "quota_reset",
      delayMs: 90 * 60 * 1000,
      retryAtIso: "2026-06-02T11:30:00.000Z",
    });
  });

  it("falls back to a 30-minute retry for uncertain quota resets", () => {
    const nowMs = new Date("2026-06-02T20:45:00.000Z").getTime();
    const decision = resolveProviderRetryDecision(
      buildQuotaClassification(null),
      workflowSettings,
      nowMs,
    );

    expect(decision).toEqual({
      kind: "quota_reset",
      delayMs: 30 * 60 * 1000,
      retryAtIso: "2026-06-02T21:15:00.000Z",
    });
  });

  it("does not block on a past quota reset timestamp", () => {
    const nowMs = new Date("2026-06-02T20:45:00.000Z").getTime();
    const decision = resolveProviderRetryDecision(
      buildQuotaClassification("2026-06-02T19:45:00.000Z"),
      workflowSettings,
      nowMs,
    );

    expect(decision).toEqual({
      kind: "quota_reset",
      delayMs: 30 * 60 * 1000,
      retryAtIso: "2026-06-02T21:15:00.000Z",
    });
  });
});
