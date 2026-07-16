import type {
  ExecutionAttentionItemSummary,
  ExecutionSprintWorkflowProjection,
} from "../../contracts/app-types.js";
import type { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { parsePayloadJson } from "./execution-utils.js";

interface PlanningProjectionRow {
  sprint_id: string;
  status: string;
}

interface HumanInterventionProjectionRow {
  id: string;
  sprint_id: string;
  task_id: string;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  assigned_worker_endpoint_id: string | null;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  opened_at: string;
  claimed_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

function queryLatestPlanningBySprint(
  db: Database,
  projectId: string,
): PlanningProjectionRow[] {
  return db.prepare(`
    WITH ranked_planning AS (
      SELECT
        COALESCE(invocation.sprint_id, provider_invocation.sprint_id) AS sprint_id,
        invocation.status,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(invocation.sprint_id, provider_invocation.sprint_id)
          ORDER BY
            COALESCE(invocation.started_at, invocation.created_at) DESC,
            invocation.created_at DESC,
            invocation.rowid DESC,
            invocation.id DESC
        ) AS planning_rank
      FROM execution_invocations invocation
      LEFT JOIN provider_invocations provider_invocation
        ON provider_invocation.id = invocation.provider_invocation_id
      WHERE invocation.project_id = ?
        AND invocation.type = 'planning'
        AND COALESCE(invocation.sprint_id, provider_invocation.sprint_id) IS NOT NULL
    )
    SELECT sprint_id, status
    FROM ranked_planning
    WHERE planning_rank = 1
    ORDER BY sprint_id ASC
  `).all(projectId) as PlanningProjectionRow[];
}

function queryActiveTaskHumanInterventionsBySprint(
  db: Database,
  projectId: string,
): HumanInterventionProjectionRow[] {
  return db.prepare(`
    WITH ranked_interventions AS (
      SELECT
        attention.*,
        ROW_NUMBER() OVER (
          PARTITION BY attention.sprint_id
          ORDER BY attention.updated_at DESC, attention.opened_at DESC, attention.id DESC
        ) AS intervention_rank
      FROM project_attention_items attention
      WHERE attention.project_id = ?
        AND attention.sprint_id IS NOT NULL
        AND attention.task_id IS NOT NULL
        AND attention.owner_type IN ('human', 'user')
        AND attention.status IN ('open', 'claimed')
        AND attention.assigned_worker_endpoint_id IS NULL
    )
    SELECT
      id,
      sprint_id,
      task_id,
      sprint_run_id,
      dispatch_id,
      attention_type,
      severity,
      owner_type,
      status,
      assigned_worker_endpoint_id,
      title,
      summary_markdown,
      payload_json,
      opened_at,
      claimed_at,
      resolved_at,
      updated_at
    FROM ranked_interventions
    WHERE intervention_rank = 1
    ORDER BY sprint_id ASC
  `).all(projectId) as unknown as HumanInterventionProjectionRow[];
}

function mapHumanIntervention(
  row: HumanInterventionProjectionRow,
): ExecutionAttentionItemSummary {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    taskId: row.task_id,
    sprintRunId: row.sprint_run_id,
    dispatchId: row.dispatch_id,
    attentionType: row.attention_type,
    severity: row.severity,
    ownerType: row.owner_type,
    status: row.status,
    assignedWorkerEndpointId: row.assigned_worker_endpoint_id,
    title: row.title,
    summaryMarkdown: row.summary_markdown,
    payload: parsePayloadJson(row.payload_json),
    openedAt: row.opened_at,
    claimedAt: row.claimed_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

export function queryExecutionSprintWorkflowProjections(
  db: Database,
  projectId: string,
): ExecutionSprintWorkflowProjection[] {
  const projections = new Map<string, ExecutionSprintWorkflowProjection>();

  for (const planning of queryLatestPlanningBySprint(db, projectId)) {
    projections.set(planning.sprint_id, {
      sprintId: planning.sprint_id,
      planningStatus: planning.status,
      humanIntervention: null,
    });
  }

  for (const row of queryActiveTaskHumanInterventionsBySprint(db, projectId)) {
    const current = projections.get(row.sprint_id);
    projections.set(row.sprint_id, {
      sprintId: row.sprint_id,
      planningStatus: current?.planningStatus ?? null,
      humanIntervention: mapHumanIntervention(row),
    });
  }

  return [...projections.values()].sort((left, right) => left.sprintId.localeCompare(right.sprintId));
}
