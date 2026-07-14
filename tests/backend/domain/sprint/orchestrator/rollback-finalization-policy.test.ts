import { describe, expect, it } from "vitest";
import type { CiIntelligenceSettings } from "../../../../../src/contracts/app-types.js";
import { resolveRollbackFinalizationCiIntelligence } from "../../../../../src/domain/sprint/orchestrator/rollback-finalization-policy.js";

const configured = {
  enabled: false,
  enableLivePrMonitoring: false,
  mainBranchAutoMergeMode: "OFF",
} as CiIntelligenceSettings;

describe("resolveRollbackFinalizationCiIntelligence", () => {
  it("forces automatic rollbacks to auto-merge through a green remote PR", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, "automatic", "REMOTE")).toMatchObject({
      enabled: true,
      enableLivePrMonitoring: true,
      mainBranchAutoMergeMode: "WHEN_GREEN",
    });
  });

  it("preserves an explicit always-auto-merge policy for automatic rollbacks", () => {
    expect(resolveRollbackFinalizationCiIntelligence({
      ...configured,
      mainBranchAutoMergeMode: "ALWAYS",
    }, "automatic", "REMOTE").mainBranchAutoMergeMode).toBe("ALWAYS");
  });

  it("uses a human PR handoff for agent rollbacks when normal auto-merge is off", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, "agent_assisted", "REMOTE")).toMatchObject({
      enabled: true,
      enableLivePrMonitoring: true,
      mainBranchAutoMergeMode: "CREATE_PR",
    });
  });

  it("does not alter standard sprint settings", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, null, "REMOTE")).toBe(configured);
  });

  it("keeps local rollback finalization on the local merge path without enabling PR monitoring", () => {
    expect(resolveRollbackFinalizationCiIntelligence(configured, "automatic", "LOCAL")).toBe(configured);
  });
});
