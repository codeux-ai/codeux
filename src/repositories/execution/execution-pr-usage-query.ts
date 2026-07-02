import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRecord, ProviderInvocationPurpose } from "../../contracts/execution-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";
import { mapProviderInvocationUsageRow } from "./execution-read-model-mappers.js";
import { usageFields, mapAggregatedUsage, SnapshotPricingResolver, UsageAggregationRow } from "./project-stats-aggregation.js";

export interface PrUsageGroup {
  provider: string;
  model: string | null;
  usage: ExecutionUsageTotals;
}

interface GroupedUsageRow extends UsageAggregationRow {
  provider: string;
  model: string | null;
}

export function queryUsageGroupsByTaskId(
  db: Database,
  projectId: string,
  taskId: string,
  pricingResolver: SnapshotPricingResolver,
): PrUsageGroup[] {
  const rows = db.prepare(`
    SELECT
      provider,
      model,
      ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND task_id = ?
    GROUP BY provider, model
  `).all(projectId, taskId) as GroupedUsageRow[];

  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    usage: mapAggregatedUsage(row, pricingResolver, row.provider, row.model),
  }));
}

export function queryUsageGroupsBySprintId(
  db: Database,
  projectId: string,
  sprintId: string,
  pricingResolver: SnapshotPricingResolver,
  purpose?: ProviderInvocationPurpose,
): PrUsageGroup[] {
  const purposeClause = purpose ? "AND purpose = ?" : "";
  const params = purpose ? [projectId, sprintId, purpose] : [projectId, sprintId];

  const rows = db.prepare(`
    SELECT
      provider,
      model,
      ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND sprint_id = ? ${purposeClause}
    GROUP BY provider, model
  `).all(...params) as GroupedUsageRow[];

  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    usage: mapAggregatedUsage(row, pricingResolver, row.provider, row.model),
  }));
}

export function queryProviderInvocationsForTask(
  db: Database,
  projectId: string,
  taskId: string,
): ProviderInvocationUsageRecord[] {
  const rows = db.prepare(`
    SELECT *
    FROM provider_invocations
    WHERE project_id = ? AND task_id = ?
    ORDER BY started_at ASC
  `).all(projectId, taskId) as ProviderInvocationUsageRow[];

  return rows.map(mapProviderInvocationUsageRow);
}

export function queryProviderInvocationsForSprint(
  db: Database,
  projectId: string,
  sprintId: string,
  purpose?: ProviderInvocationPurpose,
): ProviderInvocationUsageRecord[] {
  const purposeClause = purpose ? "AND purpose = ?" : "";
  const params = purpose ? [projectId, sprintId, purpose] : [projectId, sprintId];

  const rows = db.prepare(`
    SELECT *
    FROM provider_invocations
    WHERE project_id = ? AND sprint_id = ? ${purposeClause}
    ORDER BY started_at ASC
  `).all(...params) as ProviderInvocationUsageRow[];

  return rows.map(mapProviderInvocationUsageRow);
}
