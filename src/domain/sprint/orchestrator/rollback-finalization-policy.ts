import type { CiIntelligenceSettings } from "../../../contracts/app-types.js";
import type { SprintRollbackMode } from "../../../contracts/project-management-types.js";

export function resolveRollbackFinalizationCiIntelligence(
  configured: CiIntelligenceSettings,
  rollbackMode: SprintRollbackMode | null,
): CiIntelligenceSettings {
  if (!rollbackMode) return configured;
  const mainBranchAutoMergeMode = rollbackMode === "automatic"
    ? configured.mainBranchAutoMergeMode === "ALWAYS" ? "ALWAYS" : "WHEN_GREEN"
    : configured.mainBranchAutoMergeMode === "OFF" ? "CREATE_PR" : configured.mainBranchAutoMergeMode;
  return {
    ...configured,
    enabled: true,
    enableLivePrMonitoring: true,
    mainBranchAutoMergeMode,
  };
}
