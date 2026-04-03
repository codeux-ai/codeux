import type { ExecutionHumanInterventionSummary } from "../../contracts/app-types.js";
import type {
  ExecutionRuntimeEventSummaryRow,
  ExecutionSprintRunSummaryRow,
} from "./execution-row-mappers.js";
import type { ProjectAttentionSummaryRow } from "../execution-repository.js";
import { parsePayloadJson } from "./execution-row-mappers.js";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripMarkdown(value: string): string {
  if (!value) return value;
  return value
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildHumanInterventionSummaryBySprintRun(
  sprintRuns: Array<{ id: string; sprint_id: string; status: string } | ExecutionSprintRunSummaryRow>,
  attentionRows: ProjectAttentionSummaryRow[],
  recentEvents: ExecutionRuntimeEventSummaryRow[],
): Map<string, ExecutionHumanInterventionSummary> {
  const bySprintRunId = new Map<string, ExecutionHumanInterventionSummary>();
  const attentionBySprintRunId = new Map<string, ProjectAttentionSummaryRow[]>();
  const eventsBySprintRunId = new Map<string, ExecutionRuntimeEventSummaryRow[]>();

  for (const row of attentionRows) {
    const sprintRunId = asNonEmptyString(row.sprint_run_id) || asNonEmptyString(parsePayloadJson(row.payload_json)?.sprintRunId);
    if (!sprintRunId || !isOperatorInterventionAttentionRow(row)) {
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
    const isPaused = sprintRun.status === "paused";
    if (!isPaused) {
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

export function buildHumanInterventionSummaryFromAttentionRows(
  attentionRows: ProjectAttentionSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  const bestRow = [...attentionRows].sort((left, right) => compareAttentionPriority(left, right))[0];
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
          ? `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the PR is clean. (${prUrl})`
          : `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the branches merge cleanly.`,
      );
    }
    case "action_required": {
      const interventionOwner = String(payload?.interventionOwner || "").toUpperCase();
      const sessionState = asNonEmptyString(payload?.sessionState);
      const provider = asNonEmptyString(payload?.provider);
      const instructions = interventionOwner === "HUMAN" || bestRow.owner_type === "human"
        ? `Open the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, provide the requested input or approval, then resume the sprint.`
        : `Review the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, resolve the action-required state, then resume the sprint if worker automation does not clear it.`;
      return createHumanInterventionSummary(bestRow, title, reason, instructions);
    }
    case "manual_attention":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Open the Live view, inspect the attention queue and blocked tasks, resolve the blocker, then resume the sprint.",
      );
    case "dashboard_reply_required":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Open the project conversation thread, send the requested dashboard reply, then resolve the attention item and resume the sprint.",
      );
    case "human_escalation_required":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Open the project handoff thread, perform the requested manual action, then resolve the attention item and resume the sprint.",
      );
    case "worker_dispatch_blocked":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Review the blocked worker dispatch in Live view, address the worker error, then retry or resume the sprint.",
      );
    case "worker_lease_expired":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Check the assigned worker connection, restart or reassign it if needed, then retry or resume the sprint.",
      );
    case "dispatch_cancel_stalled":
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Review the stalled cancellation in Live view and force cancel or clean up the run before restarting the sprint.",
      );
    default:
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Review the active attention item in Live view, resolve the blocker, then resume the sprint.",
      );
  }
}

export function buildHumanInterventionSummaryFromEvents(
  sprintRunStatus: string,
  recentEvents: ExecutionRuntimeEventSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  if (recentEvents.length === 0) {
    return null;
  }

  const latestRelevantEvent = recentEvents.find((event) => (
    event.event_type === "branch_preflight_blocked"
    || event.event_type === "planning_preflight_blocked"
    || event.event_type === "sprint_merge_required"
    || event.event_type === "sprint_no_more_actions"
    || event.event_type === "sprint_paused"
  ));
  if (!latestRelevantEvent) {
    return null;
  }

  const payload = parsePayloadJson(latestRelevantEvent.payload_json);

  switch (latestRelevantEvent.event_type) {
    case "branch_preflight_blocked": {
      const featureBranch = asNonEmptyString(payload?.featureBranch) || "the sprint feature branch";
      return {
        title: "Branch preparation blocked",
        reason: `Sprint OS could not prepare ${featureBranch} automatically.`,
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
        severity: "high",
        ownerType: "human",
      };
    }
    case "sprint_no_more_actions":
    case "sprint_paused":
      if (sprintRunStatus !== "paused") {
        return null;
      }
      return {
        title: "Manual attention required",
        reason: "Sprint execution paused because no further automatic action was available.",
        instructions: "Open the Live view, inspect the blocked tasks and attention queue, resolve the blocker, then resume the sprint.",
        attentionType: null,
        severity: "medium",
        ownerType: "human",
      };
    default:
      return null;
  }
}

export function isOperatorInterventionAttentionRow(row: ProjectAttentionSummaryRow): boolean {
  if (row.status !== "open" && row.status !== "claimed") {
    return false;
  }

  if (
    row.attention_type === "merge_required"
    || row.attention_type === "manual_attention"
    || row.attention_type === "dashboard_reply_required"
    || row.attention_type === "human_escalation_required"
    || row.attention_type === "worker_dispatch_blocked"
    || row.attention_type === "worker_lease_expired"
    || row.attention_type === "dispatch_cancel_stalled"
  ) {
    return true;
  }

  if (row.attention_type === "merge_conflict") {
    return row.owner_type !== "worker";
  }

  if (row.attention_type !== "action_required") {
    return row.owner_type !== "worker";
  }

  const payload = parsePayloadJson(row.payload_json);
  return row.owner_type === "human" || String(payload?.interventionOwner || "").toUpperCase() === "HUMAN";
}

export function compareAttentionPriority(left: ProjectAttentionSummaryRow, right: ProjectAttentionSummaryRow): number {
  const attentionPriority = (value: string): number => {
    switch (value) {
      case "human_escalation_required":
        return 0;
      case "dashboard_reply_required":
        return 1;
      case "merge_conflict":
        return 2;
      case "merge_required":
        return 3;
      case "action_required":
        return 4;
      case "manual_attention":
        return 5;
      case "worker_dispatch_blocked":
        return 6;
      case "worker_lease_expired":
        return 7;
      case "dispatch_cancel_stalled":
        return 8;
      default:
        return 9;
    }
  };
  const severityPriority = (value: string): number => {
    switch (value) {
      case "critical":
        return 0;
      case "high":
        return 1;
      case "medium":
        return 2;
      default:
        return 3;
    }
  };

  return attentionPriority(left.attention_type) - attentionPriority(right.attention_type)
    || severityPriority(left.severity) - severityPriority(right.severity)
    || right.updated_at.localeCompare(left.updated_at)
    || left.id.localeCompare(right.id);
}

export function createHumanInterventionSummary(
  row: ProjectAttentionSummaryRow,
  title: string,
  reason: string,
  instructions: string,
): ExecutionHumanInterventionSummary {
  return {
    title,
    reason,
    instructions,
    attentionType: row.attention_type,
    severity: row.severity,
    ownerType: row.owner_type,
  };
}
