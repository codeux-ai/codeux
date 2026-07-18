import type {
  QaReviewFollowUpTask,
  QaReviewFollowUpTaskPriority,
  SprintReviewSummary,
} from "../../contracts/qa-review-summary.js";
import type { AppDbStorage } from "../app-db-storage.js";
import { parsePayloadJson } from "../repository-utils.js";

interface QaReviewSummaryRow {
  scope_id: string;
  status: string;
  outcome: string | null;
  summary_markdown: string | null;
  fix_instructions: string | null;
  target_task_key: string | null;
  payload_json: string | null;
  agent_name: string | null;
  finished_at: string | null;
}

const REPRESENTATIVE_REVIEW_ORDER = `
  q.run_index DESC,
  CASE
    WHEN q.status = 'running' THEN 0
    WHEN q.outcome = 'changes_requested' THEN 1
    WHEN q.status IN ('failed', 'cancelled', 'errored') THEN 2
    WHEN q.outcome = 'pass' THEN 3
    ELSE 4
  END,
  q.started_at DESC,
  q.id DESC
`;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePriority(value: unknown): QaReviewFollowUpTaskPriority {
  return value === "critical" || value === "high" || value === "low" ? value : "medium";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function normalizeFollowUpTask(value: unknown): QaReviewFollowUpTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const title = nonEmptyString(payload.title);
  const promptMarkdown = nonEmptyString(payload.promptMarkdown) || nonEmptyString(payload.prompt);
  if (!title || !promptMarkdown) return null;

  return {
    title,
    promptMarkdown,
    description: nonEmptyString(payload.description) || null,
    dependsOnTaskKeys: normalizeStringList(payload.dependsOnTaskKeys),
    priority: normalizePriority(payload.priority),
  };
}

function normalizeFollowUpTasks(value: unknown): QaReviewFollowUpTask[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => normalizeFollowUpTask(entry))
    .filter((entry): entry is QaReviewFollowUpTask => entry !== null);
}

function mapSummary(row: QaReviewSummaryRow): SprintReviewSummary {
  const payload = parsePayloadJson(row.payload_json);
  const fixInstructions = nonEmptyString(row.fix_instructions) || nonEmptyString(payload?.fixInstructions);
  const targetTaskKey = nonEmptyString(row.target_task_key) || nonEmptyString(payload?.targetTaskKey);
  const followUpTasks = normalizeFollowUpTasks(payload?.followUpTasks);

  return {
    status: row.status,
    outcome: row.outcome,
    summary: row.summary_markdown,
    findings: normalizeStringList(payload?.findings),
    reviewer: row.agent_name,
    finishedAt: row.finished_at,
    ...(fixInstructions ? { fixInstructions } : {}),
    ...(targetTaskKey ? { targetTaskKey } : {}),
    ...(followUpTasks ? { followUpTasks } : {}),
  };
}

function mapRows(rows: QaReviewSummaryRow[]): Map<string, SprintReviewSummary> {
  return new Map(rows.map((row) => [row.scope_id, mapSummary(row)]));
}

export function loadLatestTaskReviewSummaryMap(
  storage: AppDbStorage,
  taskIds: string[],
): Map<string, SprintReviewSummary> {
  const rows = storage.executeChunkedInQuery<QaReviewSummaryRow>({
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
      SELECT
        scope_id,
        status,
        outcome,
        summary_markdown,
        fix_instructions,
        target_task_key,
        payload_json,
        agent_name,
        finished_at
      FROM (
        SELECT
          q.task_id AS scope_id,
          q.status,
          q.outcome,
          q.summary_markdown,
          q.fix_instructions,
          q.target_task_key,
          q.payload_json,
          q.agent_name,
          q.finished_at,
          ROW_NUMBER() OVER (
            PARTITION BY q.task_id
            ORDER BY ${REPRESENTATIVE_REVIEW_ORDER}
          ) AS row_number
        FROM (
          SELECT
            q.*,
            ROW_NUMBER() OVER (
              PARTITION BY
                q.task_id,
                q.run_index,
                COALESCE(NULLIF(TRIM(q.agent_preset_id), ''), NULLIF(TRIM(q.agent_name), ''), q.id)
              ORDER BY q.started_at DESC, q.created_at DESC, q.id DESC
            ) AS reviewer_row_number
          FROM qa_review_runs q
          LEFT JOIN latest_sprint_runs lsr ON lsr.sprint_id = q.sprint_id
          JOIN tasks reviewed_task ON reviewed_task.id = q.task_id
          WHERE q.task_id`,
    sqlSuffix: `
            AND q.trigger_type IN ('task_completion', 'completed_task_without_pr')
            AND NOT (
              (reviewed_task.status = 'completed' OR reviewed_task.is_merged = 1)
              AND (
                q.status IN ('running', 'failed', 'cancelled', 'errored')
                OR q.outcome IN ('changes_requested', 'failed', 'rejected')
              )
            )
            AND (
              lsr.id IS NULL
              OR q.sprint_run_id = lsr.id
              OR (
                q.sprint_run_id IS NULL
                AND q.created_at >= COALESCE(lsr.started_at, lsr.created_at)
              )
            )
        ) q
        WHERE q.reviewer_row_number = 1
      )
      WHERE row_number = 1
      ORDER BY scope_id ASC
    `,
    items: taskIds,
  });
  return mapRows(rows);
}

export function loadLatestSprintReviewSummaryMap(
  storage: AppDbStorage,
  sprintIds: string[],
): Map<string, SprintReviewSummary> {
  const rows = storage.executeChunkedInQuery<QaReviewSummaryRow>({
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
      SELECT
        scope_id,
        status,
        outcome,
        summary_markdown,
        fix_instructions,
        target_task_key,
        payload_json,
        agent_name,
        finished_at
      FROM (
        SELECT
          q.sprint_id AS scope_id,
          q.status,
          q.outcome,
          q.summary_markdown,
          q.fix_instructions,
          q.target_task_key,
          q.payload_json,
          q.agent_name,
          q.finished_at,
          ROW_NUMBER() OVER (
            PARTITION BY q.sprint_id
            ORDER BY ${REPRESENTATIVE_REVIEW_ORDER}
          ) AS row_number
        FROM (
          SELECT
            q.*,
            ROW_NUMBER() OVER (
              PARTITION BY
                q.sprint_id,
                q.run_index,
                COALESCE(NULLIF(TRIM(q.agent_preset_id), ''), NULLIF(TRIM(q.agent_name), ''), q.id)
              ORDER BY q.started_at DESC, q.created_at DESC, q.id DESC
            ) AS reviewer_row_number
          FROM qa_review_runs q
          LEFT JOIN latest_sprint_runs lsr ON lsr.sprint_id = q.sprint_id
          WHERE q.sprint_id`,
    sqlSuffix: `
            AND q.trigger_type = 'sprint_completion'
            AND (
              lsr.id IS NULL
              OR q.sprint_run_id = lsr.id
              OR (
                q.sprint_run_id IS NULL
                AND q.created_at >= COALESCE(lsr.started_at, lsr.created_at)
              )
            )
        ) q
        WHERE q.reviewer_row_number = 1
      )
      WHERE row_number = 1
      ORDER BY scope_id ASC
    `,
    items: sprintIds,
  });
  return mapRows(rows);
}
