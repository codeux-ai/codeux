import { describe, expect, it } from "vitest";
import type { CiIntelligenceSettings } from "../../../../../src/contracts/app-types.js";
import { resolveRollbackFinalizationCiIntelligence } from "../../../../../src/domain/sprint/orchestrator/rollback-finalization-policy.js";

const configured = {
  enabled: false,
  enableLivePrMonitoring: false,
  mainBranchAutoMergeMode: "OFF",
} as CiIntelligenceSettings;

describe("resolveRollbackFinalizationCiIntelligence", () => {
  it("forces a remote PR handoff for rollback sprints", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, true)).toMatchObject({
      enabled: true,
      enableLivePrMonitoring: true,
      mainBranchAutoMergeMode: "CREATE_PR",
    });
  });

  it("preserves configured auto-merge behavior for rollback sprints", () => {
    expect(resolveRollbackFinalizationCiIntelligence({
      ...configured,
      mainBranchAutoMergeMode: "WHEN_GREEN",
    }, true).mainBranchAutoMergeMode).toBe("WHEN_GREEN");
  });

  it("does not alter standard sprint settings", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, false)).toBe(configured);
  });
});
