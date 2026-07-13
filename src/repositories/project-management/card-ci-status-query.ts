import type { AppDbStorage } from "../app-db-storage.js";
import type { CardCiGateEvent } from "../../domain/sprint/card-ci-status.js";
import { parsePayloadJson } from "../repository-utils.js";

interface LatestTaskGateRow {
  task_id: string;
  event_id: string;
  payload_json: string | null;
  created_at: string;
}

interface LatestMainMergeGateRow {
  sprint_id: string;
  event_id: string;
  payload_json: string | null;
  created_at: string;
}

interface ActiveCiAttentionRow {
  id: string;
  sprint_id: string | null;
  task_id: string | null;
  attention_type: string;
  payload_json: string | null;
}

export interface CardCiStatusEvidence {
  latestTaskGateByTaskId: Map<string, CardCiGateEvent>;
  latestMainMergeGateBySprintId: Map<string, CardCiGateEvent>;
  failedTaskIds: Set<string>;
  failedSprintIds: Set<string>;
}

function isCiHandoff(attentionType: string, payload: Record<string, unknown> | null): boolean {
  if (attentionType !== "human_escalation_required" && attentionType !== "dashboard_reply_required") {
    return false;
  }
  return payload?.sourceAttentionType === "ci_fix_required" || payload?.sourceAttentionType === "ci_fix";
}

export function loadCardCiStatusEvidence(
  storage: AppDbStorage,
  input: { taskIds: string[]; sprintIds: string[] },
): CardCiStatusEvidence {
  const taskIds = [...new Set(input.taskIds)];
  const taskIdSet = new Set(taskIds);
  const sprintIds = [...new Set(input.sprintIds)];
  const latestTaskGateByTaskId = new Map<string, CardCiGateEvent>();
  const latestMainMergeGateBySprintId = new Map<string, CardCiGateEvent>();
  const failedTaskIds = new Set<string>();
  const failedSprintIds = new Set<string>();

  const taskGateRows = storage.executeChunkedInQuery<LatestTaskGateRow>({
    sqlPrefix: `
      SELECT task_id, event_id, payload_json, created_at
      FROM (
        SELECT
          tr.task_id,
          tre.id AS event_id,
          tre.payload_json,
          tre.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY tr.task_id
            ORDER BY tre.created_at DESC, tre.id DESC
          ) AS row_number
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        WHERE tr.task_id`,
    sqlSuffix: `
          AND tre.event_type = 'ci_gate_status'
      )
      WHERE row_number = 1
      ORDER BY task_id ASC
    `,
    items: taskIds,
  });
  for (const row of taskGateRows) {
    latestTaskGateByTaskId.set(row.task_id, {
      createdAt: row.created_at,
      payload: parsePayloadJson(row.payload_json),
    });
  }

  const mainGateRows = storage.executeChunkedInQuery<LatestMainMergeGateRow>({
    sqlPrefix: `
      SELECT sprint_id, event_id, payload_json, created_at
      FROM (
        SELECT
          sr.sprint_id,
          sre.id AS event_id,
          sre.payload_json,
          sre.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY sr.sprint_id
            ORDER BY sre.created_at DESC, sre.id DESC
          ) AS row_number
        FROM sprint_run_events sre
        INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
        WHERE sr.sprint_id`,
    sqlSuffix: `
          AND sre.event_type = 'main_merge_gate_status'
      )
      WHERE row_number = 1
      ORDER BY sprint_id ASC
    `,
    items: sprintIds,
  });
  for (const row of mainGateRows) {
    latestMainMergeGateBySprintId.set(row.sprint_id, {
      createdAt: row.created_at,
      payload: parsePayloadJson(row.payload_json),
    });
  }

  const attentionSqlSuffix = `
      AND pai.status IN ('open', 'claimed')
      AND pai.attention_type IN ('ci_fix_required', 'human_escalation_required', 'dashboard_reply_required')
    ORDER BY pai.updated_at DESC, pai.opened_at DESC, pai.id DESC
  `;
  const taskAttentionRows = storage.executeChunkedInQuery<ActiveCiAttentionRow>({
    sqlPrefix: `
      SELECT pai.id, pai.sprint_id, pai.task_id, pai.attention_type, pai.payload_json
      FROM project_attention_items pai
      WHERE pai.task_id`,
    sqlSuffix: attentionSqlSuffix,
    items: taskIds,
  });
  const sprintAttentionRows = storage.executeChunkedInQuery<ActiveCiAttentionRow>({
    sqlPrefix: `
      SELECT
        pai.id,
        COALESCE(pai.sprint_id, sr.sprint_id) AS sprint_id,
        pai.task_id,
        pai.attention_type,
        pai.payload_json
      FROM project_attention_items pai
      LEFT JOIN sprint_runs sr ON sr.id = pai.sprint_run_id
      WHERE COALESCE(pai.sprint_id, sr.sprint_id)`,
    sqlSuffix: attentionSqlSuffix,
    items: sprintIds,
  });
  const attentionRows = [...new Map(
    [...taskAttentionRows, ...sprintAttentionRows].map((row) => [row.id, row]),
  ).values()];
  for (const row of attentionRows) {
    const payload = parsePayloadJson(row.payload_json);
    const isCiFailure = row.attention_type === "ci_fix_required" || isCiHandoff(row.attention_type, payload);
    if (!isCiFailure) continue;

    if (payload?.mergeStage === "main") {
      if (row.sprint_id) failedSprintIds.add(row.sprint_id);
      continue;
    }
    if (row.task_id && taskIdSet.has(row.task_id)) {
      failedTaskIds.add(row.task_id);
    }
  }

  return {
    latestTaskGateByTaskId,
    latestMainMergeGateBySprintId,
    failedTaskIds,
    failedSprintIds,
  };
}
