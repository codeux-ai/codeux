import type { AppDbStorage } from "../app-db-storage.js";
import type { CardCiStatus, SprintRecord } from "../../contracts/project-management-types.js";
import type { SprintReviewSummary } from "../../contracts/qa-review-summary.js";
import type { SprintProgressTask } from "../../domain/sprint/sprint-progress.js";
import { resolveSprintCardCiStatus, resolveTaskCardCiStatus } from "../../domain/sprint/card-ci-status.js";
import { toNumber } from "../repository-utils.js";
import { loadCardCiStatusEvidence } from "./card-ci-status-query.js";
import { loadLatestSprintReviewSummaryMap } from "./qa-review-summary-query.js";

export interface SprintSummaryAggregation {
  tasksCount: number;
  completedTasks: number;
  progressTasks: SprintProgressTask[];
  latestRunStatus: string | null;
  latestRunUpdatedAt: string | null;
  ciStatus: CardCiStatus | null;
  latestReview?: SprintReviewSummary;
}

interface SprintTaskProgressRow {
  task_id: string;
  sprint_id: string;
  status: SprintProgressTask["status"];
  is_merged: number | string | null;
  merge_indicator: SprintProgressTask["mergeIndicator"];
  coding_tool_call_count: number | string | null;
}

interface SprintLatestRunRow {
  sprint_id: string;
  latest_run_status: string | null;
  latest_run_updated_at: string | null;
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
        s.kind,
        s.rollback_source_sprint_id,
        s.rollback_mode,
        s.rollback_instructions,
        s.rollback_safety_reason,
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
      latestRunUpdatedAt: null,
      ciStatus: null,
    });
  }

  if (uniqueSprintIds.length === 0) {
    return map;
  }

  const taskRows = storage.executeChunkedInQuery<SprintTaskProgressRow>({
    sqlPrefix: `
      SELECT
        t.id AS task_id,
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
  });
  for (const row of taskRows) {
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

  const ciEvidence = loadCardCiStatusEvidence(storage, {
    taskIds: taskRows.map((row) => row.task_id),
    sprintIds: uniqueSprintIds,
  });
  const taskCiStatusesBySprintId = new Map<string, CardCiStatus[]>();
  for (const row of taskRows) {
    const ciStatus = resolveTaskCardCiStatus({
      status: row.status,
      isMerged: Boolean(toNumber(row.is_merged)),
      mergeIndicator: row.merge_indicator,
      latestGateEvent: ciEvidence.latestTaskGateByTaskId.get(row.task_id),
      hasActiveFailure: ciEvidence.failedTaskIds.has(row.task_id),
    });
    if (ciStatus) {
      const statuses = taskCiStatusesBySprintId.get(row.sprint_id) || [];
      statuses.push(ciStatus);
      taskCiStatusesBySprintId.set(row.sprint_id, statuses);
    }
  }
  for (const sprintId of uniqueSprintIds) {
    const aggregate = map.get(sprintId);
    if (aggregate) {
      aggregate.ciStatus = resolveSprintCardCiStatus({
        taskStatuses: taskCiStatusesBySprintId.get(sprintId) || [],
        latestMainMergeGateEvent: ciEvidence.latestMainMergeGateBySprintId.get(sprintId),
        hasActiveMainMergeFailure: ciEvidence.failedSprintIds.has(sprintId),
      });
    }
  }

  for (const row of storage.executeChunkedInQuery<SprintLatestRunRow>({
    sqlPrefix: `
      SELECT sprint_id, status AS latest_run_status, updated_at AS latest_run_updated_at
      FROM (
        SELECT
          sprint_id,
          status,
          updated_at,
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
      aggregate.latestRunUpdatedAt = row.latest_run_updated_at;
    }
  }

  const reviewMap = loadLatestSprintReviewSummaryMap(storage, uniqueSprintIds);
  for (const [sprintId, review] of reviewMap) {
    const aggregate = map.get(sprintId);
    if (aggregate) aggregate.latestReview = review;
  }

  return map;
}
