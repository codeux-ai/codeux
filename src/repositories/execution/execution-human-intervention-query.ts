import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { asNonEmptyString, parsePayloadJson, stripMarkdown } from "./execution-utils.js";
import { ExecutionHumanInterventionSummary, ExecutionRuntimeEventSummary } from "../../contracts/app-types.js";
import { ProjectAttentionSummaryRow } from "./execution-repository-types.js";
import { ExecutionRuntimeEventSummaryRow } from "./execution-repository-types.js";
import { getErrorMessage } from "../../shared/providers/provider-error-classifier.js";

export function isOperatorInterventionAttentionRow(row: ProjectAttentionSummaryRow): boolean {
  return [
    "merge_required",
    "merge_conflict",
    "cli_intervention_required",
    "cli_error",
  ].includes(row.attention_type);
}

function getAttentionTypePriority(type: string): number {
  switch (type) {
    case "merge_conflict":
      return 1;
    case "merge_required":
      return 2;
    case "cli_intervention_required":
      return 3;
    case "cli_error":
      return 4;
    default:
      return 99;
  }
}

function compareAttentionPriority(left: ProjectAttentionSummaryRow, right: ProjectAttentionSummaryRow): number {
  const leftPriority = getAttentionTypePriority(left.attention_type);
  const rightPriority = getAttentionTypePriority(right.attention_type);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
}

function createHumanInterventionSummary(
  row: ProjectAttentionSummaryRow | null,
  title: string,
  reason: string,
  instructions: string,
): ExecutionHumanInterventionSummary {
  return {
    title,
    reason,
    instructions,
    attentionType: row?.attention_type || null,
    severity: row?.severity || null,
    ownerType: row?.owner_type || null,
  };
}

function buildHumanInterventionSummaryFromAttentionRows(
  attentionRows: ProjectAttentionSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  const bestRow = [...attentionRows].sort(compareAttentionPriority)[0];
  if (!bestRow) {
    return null;
  }

  const payload = parsePayloadJson(bestRow.payload_json);
  const title = bestRow.title.trim() || "Human intervention required";
  const reason = stripMarkdown(bestRow.summary_markdown || title) || title;

  switch (bestRow.attention_type) {
    case "merge_required": {
      const featureBranch = asNonEmptyString(payload?.featureBranch);
      const workerBranch = asNonEmptyString(payload?.workerBranch);
      const prUrl = asNonEmptyString(payload?.prUrl);
      const taskKey = asNonEmptyString(payload?.taskKey);
      const instructions = prUrl
        ? `Review and merge the completed task PR (${prUrl})${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`
        : `Merge${taskKey ? ` ${taskKey}` : " the completed task"}${workerBranch ? ` from ${workerBranch}` : ""}${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`;
      return createHumanInterventionSummary(bestRow, title, reason, instructions);
    }
    case "merge_conflict": {
      const featureBranch = asNonEmptyString(payload?.featureBranch);
      const workerBranch = asNonEmptyString(payload?.workerBranch);
      const prUrl = asNonEmptyString(payload?.prUrl);
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        prUrl
          ? `Ask the virtual worker flow to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the PR is clean. (${prUrl})`
          : `Ask the virtual worker flow to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the branches merge cleanly.`,
      );
    }
    case "cli_intervention_required":
    case "cli_error": {
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "An unexpected error or intervention state occurred. Click below or inspect Jules outputs to resume work.",
      );
    }
    default:
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Human intervention or review is required.",
      );
  }
}

function buildHumanInterventionSummaryFromEvents(
  sprintRunStatus: string,
  events: ExecutionRuntimeEventSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  if (events.length === 0) {
    return null;
  }

  const latestRelevantEvent = events.find((event) => (
    event.event_type === "branch_preflight_blocked"
    || event.event_type === "planning_preflight_blocked"
    || event.event_type === "sprint_merge_required"
    || event.event_type === "sprint_no_more_actions"
    || event.event_type === "sprint_paused"
  ));
  if (latestRelevantEvent) {
    const payload = parsePayloadJson(latestRelevantEvent.payload_json);
    switch (latestRelevantEvent.event_type) {
      case "branch_preflight_blocked": {
        const featureBranch = asNonEmptyString(payload?.featureBranch) || "the sprint feature branch";
        return {
          title: "Branch preparation blocked",
          reason: `Code UX could not prepare ${featureBranch} automatically.`,
          instructions: "Check git authentication, remote push permissions, and local branch state, then resume the sprint.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "planning_preflight_blocked": {
        const planningTarget = asNonEmptyString(payload?.planningTarget) || "this sprint";
        return {
          title: "Sprint planning required",
          reason: `${planningTarget} must be planned into executable tasks before orchestration can continue.`,
          instructions: "Use Plan Sprint on the Sprints page, review the generated tasks, then start the sprint again.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_merge_required": {
        const awaitingMergeCount = Number(payload?.awaitingMergeCount || 0);
        return {
          title: "Manual merge required",
          reason: `Sprint execution paused because ${awaitingMergeCount || "one or more"} completed task${awaitingMergeCount === 1 ? "" : "s"} still need manual merge work.`,
          instructions: "Merge the completed task branches or PRs into the sprint branch, then resume the sprint. You can enable feature PR automerge later to reduce manual merges.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_no_more_actions":
        return {
          title: "Waiting for work",
          reason: "There are no pending, actionable tasks available in the active sprint.",
          instructions: "Add tasks to the sprint, or resolve blocking tasks to free up dependent work.",
          attentionType: null,
          severity: "low",
          ownerType: "human",
        };
      case "sprint_paused":
        if (sprintRunStatus !== "paused") {
          return null;
        }
        return {
          title: "Sprint paused",
          reason: "The sprint was manually paused by a team member.",
          instructions: "Resume the sprint when ready to continue execution.",
          attentionType: null,
          severity: "low",
          ownerType: "human",
        };
    }
  }

  if (sprintRunStatus !== "error" && sprintRunStatus !== "paused") {
    return null;
  }

  const errorEvents = [...events].filter((e) => e.event_type === "dispatch_error" || e.event_type === "sprint_run_error");
  errorEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  for (const errorEvent of errorEvents) {
    const payload = parsePayloadJson(errorEvent.payload_json);
    if (!payload || !("error" in payload)) {
      continue;
    }
    const reason = getErrorMessage(payload.error, "An unknown execution error occurred");
    const shortReason = reason.length > 500 ? reason.substring(0, 500) + "..." : reason;

    if (errorEvent.event_type === "dispatch_error") {
      const title = errorEvent.task_title ? `Task Error: ${errorEvent.task_title}` : "Task Dispatch Error";
      return createHumanInterventionSummary(
        null,
        title,
        shortReason,
        "A task dispatch failed. Review the task logs, perform any necessary cleanup, and resume the sprint.",
      );
    }

    if (errorEvent.event_type === "sprint_run_error") {
      return createHumanInterventionSummary(
        null,
        "Sprint Execution Error",
        shortReason,
        "A critical execution error occurred during the sprint. Review the sprint logs, perform any necessary cleanup, and resume the sprint.",
      );
    }
  }

  return null;
}

export function buildHumanInterventionSummaryBySprintRun(
  sprintRuns: Array<{ id: string; sprint_id: string; status: string }>,
  attentionRows: ProjectAttentionSummaryRow[],
  recentEvents: ExecutionRuntimeEventSummaryRow[],
): Map<string, ExecutionHumanInterventionSummary> {
  const bySprintRunId = new Map<string, ExecutionHumanInterventionSummary>();
  const attentionBySprintRunId = new Map<string, ProjectAttentionSummaryRow[]>();
  const eventsBySprintRunId = new Map<string, ExecutionRuntimeEventSummaryRow[]>();

  for (const row of attentionRows) {
    const sprintRunId = asNonEmptyString(row.sprint_run_id);
    if (!sprintRunId || !isOperatorInterventionAttentionRow(row)) {
      continue;
    }
    if (row.owner_type === "worker" && (row.status === "claimed" || row.status === "resolved")) {
      continue;
    }
    const existing = attentionBySprintRunId.get(sprintRunId) || [];
    existing.push(row);
    attentionBySprintRunId.set(sprintRunId, existing);
  }

  for (const event of recentEvents) {
    const sprintRunId = asNonEmptyString(event.sprint_run_id);
    if (!sprintRunId) {
      continue;
    }
    const existing = eventsBySprintRunId.get(sprintRunId) || [];
    existing.push(event);
    eventsBySprintRunId.set(sprintRunId, existing);
  }

  for (const sprintRun of sprintRuns) {
    if (sprintRun.status === "completed" || sprintRun.status === "cancelled" || sprintRun.status === "continued" || sprintRun.status === "failed") {
      continue;
    }

    const attentionSummary = buildHumanInterventionSummaryFromAttentionRows(
      attentionBySprintRunId.get(sprintRun.id) || [],
    );
    if (attentionSummary) {
      bySprintRunId.set(sprintRun.id, attentionSummary);
      continue;
    }
    const eventSummary = buildHumanInterventionSummaryFromEvents(
      sprintRun.status,
      eventsBySprintRunId.get(sprintRun.id) || [],
    );
    if (eventSummary) {
      bySprintRunId.set(sprintRun.id, eventSummary);
    }
  }

  return bySprintRunId;
}

export function listActiveAttentionRowsForProject(db: Database, projectId: string): ProjectAttentionSummaryRow[] {
  return db.prepare(`
    SELECT
      id,
      project_id,
      sprint_id,
      sprint_run_id,
      attention_type,
      severity,
      owner_type,
      status,
      title,
      summary_markdown,
      payload_json,
      updated_at
    FROM project_attention_items
    WHERE project_id = ?
      AND status IN ('open', 'claimed')
    ORDER BY updated_at DESC, opened_at DESC, id DESC
  `).all(projectId) as unknown as ProjectAttentionSummaryRow[];
}

export function listActiveAttentionRowsForSprintRuns(storage: AppDbStorage, sprintRunIds: string[]): ProjectAttentionSummaryRow[] {
  if (sprintRunIds.length === 0) {
    return [];
  }

  return storage.executeChunkedInQuery<ProjectAttentionSummaryRow>({
    sqlPrefix: `SELECT
      id,
      project_id,
      sprint_id,
      sprint_run_id,
      attention_type,
      severity,
      owner_type,
      status,
      title,
      summary_markdown,
      payload_json,
      updated_at
    FROM project_attention_items
    WHERE sprint_run_id`,
    sqlSuffix: "AND status IN ('open', 'claimed') ORDER BY updated_at DESC, opened_at DESC, id DESC",
    items: sprintRunIds,
  });
}
