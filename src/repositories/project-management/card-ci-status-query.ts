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
      WITH latest_sprint_runs AS (
        SELECT sprint_id, id, started_at, created_at
        FROM (
          SELECT
            sr.sprint_id,
            sr.id,
            sr.started_at,
            sr.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY sr.sprint_id
              ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
            ) AS row_number
          FROM sprint_runs sr
        )
        WHERE row_number = 1
      )
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
        LEFT JOIN latest_sprint_runs lsr ON lsr.sprint_id = tr.sprint_id
        WHERE tr.task_id`,
    sqlSuffix: `
          AND tre.event_type = 'ci_gate_status'
          AND (
            lsr.id IS NULL
            OR tr.sprint_run_id = lsr.id
            OR (
              tr.sprint_run_id IS NULL
              AND tre.created_at >= COALESCE(lsr.started_at, lsr.created_at)
            )
          )
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
      WITH latest_sprint_runs AS (
        SELECT sprint_id, id
        FROM (
          SELECT
            sr.sprint_id,
            sr.id,
            ROW_NUMBER() OVER (
              PARTITION BY sr.sprint_id
              ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
            ) AS row_number
          FROM sprint_runs sr
        )
        WHERE row_number = 1
      )
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
        INNER JOIN latest_sprint_runs lsr ON lsr.id = sr.id
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

  const activeAttentionSql = `
      AND pai.status IN ('open', 'claimed')
      AND pai.attention_type IN ('ci_fix_required', 'human_escalation_required', 'dashboard_reply_required')
  `;
  const taskAttentionRows = storage.executeChunkedInQuery<ActiveCiAttentionRow>({
    sqlPrefix: `
      SELECT
        pai.id,
        COALESCE(pai.sprint_id, attention_run.sprint_id, attention_task.sprint_id) AS sprint_id,
        pai.task_id,
        pai.attention_type,
        pai.payload_json
      FROM project_attention_items pai
      LEFT JOIN sprint_runs attention_run ON attention_run.id = pai.sprint_run_id
      LEFT JOIN tasks attention_task ON attention_task.id = pai.task_id
      WHERE pai.task_id`,
    sqlSuffix: `
      ${activeAttentionSql}
      AND (
        pai.sprint_run_id IS NULL
        OR pai.sprint_run_id = (
          SELECT latest_run.id
          FROM sprint_runs latest_run
          WHERE latest_run.sprint_id = COALESCE(
            pai.sprint_id,
            attention_run.sprint_id,
            attention_task.sprint_id
          )
          ORDER BY COALESCE(latest_run.started_at, latest_run.created_at) DESC,
            latest_run.created_at DESC,
            latest_run.rowid DESC
          LIMIT 1
        )
      )
      ORDER BY pai.updated_at DESC, pai.opened_at DESC, pai.id DESC
    `,
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
    sqlSuffix: `
      ${activeAttentionSql}
      AND (
        pai.sprint_run_id IS NULL
        OR pai.sprint_run_id = (
          SELECT latest_run.id
          FROM sprint_runs latest_run
          WHERE latest_run.sprint_id = COALESCE(pai.sprint_id, sr.sprint_id)
          ORDER BY COALESCE(latest_run.started_at, latest_run.created_at) DESC,
            latest_run.created_at DESC,
            latest_run.rowid DESC
          LIMIT 1
        )
      )
      ORDER BY pai.updated_at DESC, pai.opened_at DESC, pai.id DESC
    `,
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
