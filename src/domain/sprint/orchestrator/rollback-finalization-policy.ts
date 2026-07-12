import type { CiIntelligenceSettings } from "../../../contracts/app-types.js";

export function resolveRollbackFinalizationCiIntelligence(
  configured: CiIntelligenceSettings,
  isRollback: boolean,
): CiIntelligenceSettings {
  if (!isRollback) return configured;
  return {
    ...configured,
    enabled: true,
    enableLivePrMonitoring: true,
    mainBranchAutoMergeMode: configured.mainBranchAutoMergeMode === "OFF"
      ? "CREATE_PR"
      : configured.mainBranchAutoMergeMode,
  };
}
