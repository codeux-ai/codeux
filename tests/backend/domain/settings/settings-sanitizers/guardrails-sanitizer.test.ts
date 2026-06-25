import { describe, expect, it } from "vitest";
import { sanitizeGuardrails } from "../../../../../src/domain/settings/settings-sanitizers/guardrails-sanitizer.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

describe("sanitizeGuardrails", () => {
  it("returns defaults when no input is provided", () => {
    const result = sanitizeGuardrails(undefined);
    expect(result).toEqual(DEFAULT_DASHBOARD_SETTINGS.guardrails);
  });

  it("clamps caps to the allowed range and falls back to valid actions", () => {
    const result = sanitizeGuardrails({
      guardrails: {
        enabled: true,
        perTaskTotalCeiling: 99999,
        jobs: {
          task_coding: { cap: -5, onLimit: "NONSENSE" as any },
          ci_fix: { cap: 999, onLimit: "WARN_ONLY" },
        } as any,
      },
    } as any);

    expect(result.jobs.task_coding.cap).toBe(0); // clamped to MIN
    expect(result.jobs.task_coding.onLimit).toBe(DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.task_coding.onLimit);
    expect(result.jobs.ci_fix.cap).toBe(100); // clamped to MAX
    expect(result.jobs.ci_fix.onLimit).toBe("WARN_ONLY");
    expect(result.perTaskTotalCeiling).toBe(500); // clamped to MAX ceiling
  });

  it("migrates the legacy julesCiAutofixMaxRetries into ci_fix.cap when guardrails is absent", () => {
    const result = sanitizeGuardrails({
      ciIntelligence: { julesCiAutofixMaxRetries: 7 } as any,
    } as any);
    expect(result.jobs.ci_fix.cap).toBe(7);
    // The historical clarification limit of 3 is seeded as the default.
    expect(result.jobs.clarification_reply.cap).toBe(3);
  });

  it("migrates the legacy ci_fix limit even when other guardrail fields are present but jobs.ci_fix is missing", () => {
    const result = sanitizeGuardrails({
      ciIntelligence: { julesCiAutofixMaxRetries: 9 } as any,
      guardrails: {
        enabled: true,
        jobs: { task_coding: { cap: 4, onLimit: "BLOCK_AND_ESCALATE" } },
      } as any,
    } as any);
    expect(result.jobs.task_coding.cap).toBe(4);
    expect(result.jobs.ci_fix.cap).toBe(9);
  });

  it("uses explicit guardrail values over the legacy migration when both are present", () => {
    const result = sanitizeGuardrails({
      ciIntelligence: { julesCiAutofixMaxRetries: 9 } as any,
      guardrails: {
        jobs: { ci_fix: { cap: 2, onLimit: "BLOCK_AND_ESCALATE" } },
      } as any,
    } as any);
    expect(result.jobs.ci_fix.cap).toBe(2);
  });
});
