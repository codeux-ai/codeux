import type { AppDbStorage } from "../app-db-storage.js";
import type { SprintReviewSummary, SprintRecord } from "../../contracts/project-management-types.js";
import type { SprintProgressTask } from "../../domain/sprint/sprint-progress.js";
import { toNumber } from "../repository-utils.js";

export interface SprintSummaryAggregation {
  tasksCount: number;
  completedTasks: number;
  progressTasks: SprintProgressTask[];
  latestRunStatus: string | null;
  latestReview?: SprintReviewSummary;
}

interface SprintTaskProgressRow {
  sprint_id: string;
  status: SprintProgressTask["status"];
  is_merged: number | string | null;
  merge_indicator: SprintProgressTask["mergeIndicator"];
  coding_tool_call_count: number | string | null;
}

interface SprintLatestRunRow {
  sprint_id: string;
  latest_run_status: string | null;
}

interface SprintLatestReviewRow {
  sprint_id: string;
  latest_sprint_review_json: string | null;
}

export const sprintSummaryQuery = {
  select: `
      SELECT
        s.id,
        s.project_id,
        s.number,
        s.slug,
        s.name,
        s.is_generated_name,
        s.original_prompt,
        s.goal,
        s.status,
        s.showcase_pinned,
        s.start_date,
        s.end_date,
        s.feature_branch,
        s.base_commit_sha,
        s.created_at,
        s.updated_at
  `,
  from: `
      FROM sprints s
  `,
};

export function loadSprintSummaryAggregationMap(
  storage: AppDbStorage,
  sprintIds: string[]
): Map<string, SprintSummaryAggregation> {
  const uniqueSprintIds = [...new Set(sprintIds)];
  const map = new Map<string, SprintSummaryAggregation>();
  for (const sprintId of uniqueSprintIds) {
    map.set(sprintId, {
      tasksCount: 0,
      completedTasks: 0,
      progressTasks: [],
      latestRunStatus: null,
    });
  }

  if (uniqueSprintIds.length === 0) {
    return map;
  }

  for (const row of storage.executeChunkedInQuery<SprintTaskProgressRow>({
    sqlPrefix: `
      SELECT
        t.sprint_id,
        t.status,
        t.is_merged,
        t.merge_indicator,
        COALESCE(SUM(pi.tool_call_count), 0) AS coding_tool_call_count
      FROM tasks t
      LEFT JOIN provider_invocations pi
        ON pi.task_id = t.id
        AND pi.purpose = 'task_coding'
      WHERE t.sprint_id`,
    sqlSuffix: `
      GROUP BY t.sprint_id, t.id, t.status, t.is_merged, t.merge_indicator
    `,
    items: uniqueSprintIds,
  })) {
    const aggregate = map.get(row.sprint_id);
    if (aggregate) {
      aggregate.tasksCount += 1;
      if (row.status === "completed") {
        aggregate.completedTasks += 1;
      }
      aggregate.progressTasks.push({
        status: row.status,
        isMerged: Boolean(toNumber(row.is_merged)),
        mergeIndicator: row.merge_indicator,
        toolCallCount: toNumber(row.coding_tool_call_count),
      });
    }
  }

  for (const row of storage.executeChunkedInQuery<SprintLatestRunRow>({
    sqlPrefix: `
      SELECT sprint_id, status AS latest_run_status
      FROM (
        SELECT
          sprint_id,
          status,
          ROW_NUMBER() OVER (
            PARTITION BY sprint_id
            ORDER BY COALESCE(started_at, created_at) DESC, created_at DESC, rowid DESC
          ) AS row_number
        FROM sprint_runs
        WHERE sprint_id`,
    sqlSuffix: `
      )
      WHERE row_number = 1
    `,
    items: uniqueSprintIds,
  })) {
    const aggregate = map.get(row.sprint_id);
    if (aggregate) {
      aggregate.latestRunStatus = row.latest_run_status;
    }
  }

  for (const row of storage.executeChunkedInQuery<SprintLatestReviewRow>({
    sqlPrefix: `
      SELECT
        sprint_id,
        json_object(
          'status', status,
          'outcome', outcome,
          'summary', summary_markdown,
          'findings', COALESCE(json_extract(payload_json, '$.findings'), json_array()),
          'reviewer', agent_name,
          'finishedAt', finished_at
        ) AS latest_sprint_review_json
      FROM (
        SELECT
          sprint_id,
          status,
          outcome,
          summary_markdown,
          payload_json,
          agent_name,
          finished_at,
          ROW_NUMBER() OVER (
            PARTITION BY sprint_id
            ORDER BY started_at DESC, rowid DESC
          ) AS row_number
        FROM qa_review_runs
        WHERE sprint_id`,
    sqlSuffix: `
          AND trigger_type = 'sprint_completion'
      )
      WHERE row_number = 1
    `,
    items: uniqueSprintIds,
  })) {
    const aggregate = map.get(row.sprint_id);
    if (!aggregate || !row.latest_sprint_review_json) {
      continue;
    }
    try {
      const parsed = JSON.parse(row.latest_sprint_review_json) as SprintReviewSummary;
      parsed.findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      aggregate.latestReview = parsed;
    } catch {
      // Ignore malformed persisted QA payloads.
    }
  }

  return map;
}
