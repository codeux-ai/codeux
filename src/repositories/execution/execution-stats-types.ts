import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";

export interface StatsEntityMetadata {
  label: string;
  secondaryLabel: string | null;
  status: string | null;
  provider: string | null;
  purpose: string | null;
  lastActivityAt: string | null;
}

export interface ProjectStatsQueryDependencies {
  requireProject: (id: string) => void;
  getWallTimeTotalsByTaskIdsForRange: (id: string, s: string, e: string, n: string) => Map<string, number>;
  getWallTimeTotalsBySprintRunIdsForRange: (id: string, s: string, e: string, n: string) => Map<string, number>;
  getTaskMetadata: (id: string) => Map<string, StatsEntityMetadata>;
  getSprintMetadata: (id: string) => Map<string, StatsEntityMetadata>;
  mapProviderInvocationUsageRow: (row: ProviderInvocationUsageRow) => ProviderInvocationUsageRecord;
  mergeUsageTotals: (target: ExecutionUsageTotals, source: ProviderInvocationUsageRecord) => void;
  mergeUsageMap: (map: Map<string, ExecutionUsageTotals>, key: string | null, source: ProviderInvocationUsageRecord) => void;
  updateLastActivity: (map: Map<string, string>, key: string | null, date: string | null) => void;
}
