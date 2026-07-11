import type {
  DashboardNotification,
  DashboardNotificationFeed,
  DashboardNotificationKind,
  DashboardNotificationSeverity,
  DashboardNotificationSourceType,
} from "../../contracts/dashboard-notification-types.js";
import type {
  ProjectAttentionOwnerType,
  ProjectAttentionStatus,
} from "../../contracts/project-attention-types.js";
import { DatabaseAdapter as Database } from "../db/database-adapter.js";

const DEFAULT_NOTIFICATION_LIMIT = 100;
const MAX_NOTIFICATION_LIMIT = 200;
const CANDIDATE_MULTIPLIER = 3;
const MAX_TEXT_LENGTH = 1_000;

interface NotificationContextRow {
  project_id: string;
  project_name: string;
  sprint_id: string | null;
  sprint_name: string | null;
  sprint_number: number | string | null;
  sprint_run_id: string | null;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
}

interface AttentionNotificationRow extends NotificationContextRow {
  id: string;
  dispatch_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  title: string;
  summary_markdown: string;
  opened_at: string;
  updated_at: string;
}

interface FailedDispatchRow extends NotificationContextRow {
  id: string;
  error_message: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface FailedSprintRunRow extends NotificationContextRow {
  id: string;
  created_at: string;
  finished_at: string | null;
  updated_at: string;
}

interface ExecutionEventRow extends NotificationContextRow {
  id: string;
  source_type: Extract<DashboardNotificationSourceType, "task_run_event" | "sprint_run_event">;
  task_run_id: string | null;
  dispatch_id: string | null;
  event_type: string;
  originator: string | null;
  payload_json: string | null;
  created_at: string;
}

interface Candidate extends DashboardNotification {
  dedupeKey: string;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(MAX_NOTIFICATION_LIMIT, Math.max(1, Math.trunc(limit!)));
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeText(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? stripMarkdown(value) : "";
  const redacted = raw
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .trim();
  return (redacted || fallback).slice(0, MAX_TEXT_LENGTH);
}

function parseSafeReason(payloadJson: string | null, fallback: string): string {
  if (!payloadJson) return fallback;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    for (const key of ["errorMessage", "reason", "message", "error"]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
        return sanitizeText(value, fallback);
      }
    }
  } catch {
    // Malformed historical payloads are ignored rather than exposed.
  }
  return fallback;
}

function severity(value: string): DashboardNotificationSeverity {
  return value === "low" || value === "medium" || value === "critical" ? value : "high";
}

function contextLinks(row: NotificationContextRow): DashboardNotification["links"] {
  const projectId = encodeURIComponent(row.project_id);
  const sprintId = row.sprint_id ? encodeURIComponent(row.sprint_id) : null;
  const taskId = row.task_id ? encodeURIComponent(row.task_id) : null;
  return {
    project: `/projects?projectId=${projectId}`,
    sprint: sprintId ? `/sprints?projectId=${projectId}&sprintId=${sprintId}` : null,
    task: taskId ? `/tasks?projectId=${projectId}${sprintId ? `&sprintId=${sprintId}` : ""}&taskId=${taskId}` : null,
    live: sprintId ? `/live?projectId=${projectId}&sprintId=${sprintId}` : null,
  };
}

function scopeKey(row: NotificationContextRow): string {
  return row.task_id
    ? `${row.project_id}:${row.sprint_run_id || row.sprint_id || "none"}:task:${row.task_id}`
    : `${row.project_id}:${row.sprint_run_id || row.sprint_id || "none"}:sprint`;
}

function toBase(
  row: NotificationContextRow,
  input: Pick<DashboardNotification, "id" | "kind" | "severity" | "title" | "summary" | "reason" | "instructions" | "attentionItemId" | "createdAt" | "updatedAt" | "source">,
): DashboardNotification {
  const sprintNumber = row.sprint_number === null ? null : Number(row.sprint_number);
  return {
    ...input,
    projectId: row.project_id,
    projectName: sanitizeText(row.project_name, "Unknown project"),
    sprintId: row.sprint_id,
    sprintName: row.sprint_name ? sanitizeText(row.sprint_name, "Unknown sprint") : null,
    sprintNumber: Number.isFinite(sprintNumber) ? sprintNumber : null,
    taskId: row.task_id,
    taskKey: row.task_key,
    taskTitle: row.task_title ? sanitizeText(row.task_title, "Untitled task") : null,
    links: contextLinks(row),
  };
}

function attentionInstructions(type: string): string {
  switch (type) {
    case "merge_required":
      return "Review and merge the completed work, then resume the sprint.";
    case "merge_conflict":
      return "Resolve the merge conflict, verify the branch is clean, and resume execution.";
    case "dashboard_reply_required":
      return "Open the task conversation, provide the requested response, and resume execution.";
    case "human_escalation_required":
      return "Review the escalation details, decide the next action, and resume or stop the sprint.";
    default:
      return "Review the intervention details and use the linked project context to continue safely.";
  }
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return left.id.localeCompare(right.id);
}

export class DashboardNotificationQuery {
  constructor(private readonly db: Database) {}

  getDashboardNotifications(input: { limit?: number } = {}): DashboardNotificationFeed {
    const limit = normalizeLimit(input.limit);
    const rowLimit = limit * CANDIDATE_MULTIPLIER;
    const activeAttention = this.loadActiveAttention(rowLimit);
    const candidates: Candidate[] = activeAttention.map((row) => this.mapAttention(row));
    const representedScopes = new Set(activeAttention.map(scopeKey));

    for (const row of this.loadFailedDispatches(rowLimit)) {
      if (!representedScopes.has(scopeKey(row))) candidates.push(this.mapFailedDispatch(row));
    }
    for (const row of this.loadFailedSprintRuns(rowLimit)) {
      if (!representedScopes.has(scopeKey(row))) candidates.push(this.mapFailedSprintRun(row));
    }
    for (const row of this.loadExecutionEvents(rowLimit)) {
      if (!representedScopes.has(scopeKey(row))) candidates.push(this.mapExecutionEvent(row));
    }

    candidates.sort(compareCandidates);
    const deduped = new Map<string, Candidate>();
    for (const candidate of candidates) {
      if (!deduped.has(candidate.dedupeKey)) deduped.set(candidate.dedupeKey, candidate);
    }
    const notifications = [...deduped.values()].slice(0, limit).map(({ dedupeKey: _dedupeKey, ...item }) => item);
    return {
      notifications,
      updatedAt: notifications[0]?.updatedAt || null,
    };
  }

  private loadActiveAttention(limit: number): AttentionNotificationRow[] {
    return this.db.prepare(`
      SELECT pai.id, pai.project_id, p.name AS project_name,
        COALESCE(pai.sprint_id, sr.sprint_id, attention_dispatch.sprint_id) AS sprint_id,
        s.name AS sprint_name, s.number AS sprint_number,
        COALESCE(pai.sprint_run_id, attention_dispatch.sprint_run_id) AS sprint_run_id,
        COALESCE(pai.task_id, attention_dispatch.task_id) AS task_id,
        t.task_key, t.title AS task_title, pai.dispatch_id,
        pai.attention_type, pai.severity, pai.owner_type, pai.status,
        pai.title, pai.summary_markdown, pai.opened_at, pai.updated_at
      FROM project_attention_items pai
      INNER JOIN projects p ON p.id = pai.project_id
      LEFT JOIN task_dispatches attention_dispatch ON attention_dispatch.id = pai.dispatch_id
      LEFT JOIN sprint_runs sr ON sr.id = COALESCE(pai.sprint_run_id, attention_dispatch.sprint_run_id)
      LEFT JOIN sprints s ON s.id = COALESCE(pai.sprint_id, sr.sprint_id, attention_dispatch.sprint_id)
      LEFT JOIN tasks t ON t.id = COALESCE(pai.task_id, attention_dispatch.task_id)
      WHERE pai.status IN ('open', 'claimed')
      ORDER BY pai.updated_at DESC, pai.opened_at DESC, pai.id ASC
      LIMIT ?
    `).all(limit) as unknown as AttentionNotificationRow[];
  }

  private loadFailedDispatches(limit: number): FailedDispatchRow[] {
    return this.db.prepare(`
      SELECT td.id, td.project_id, p.name AS project_name, td.sprint_id,
        s.name AS sprint_name, s.number AS sprint_number, td.sprint_run_id,
        td.task_id, t.task_key, t.title AS task_title,
        td.error_message, td.finished_at, td.updated_at
      FROM task_dispatches td
      INNER JOIN projects p ON p.id = td.project_id
      INNER JOIN sprints s ON s.id = td.sprint_id
      INNER JOIN tasks t ON t.id = td.task_id
      WHERE td.status IN ('failed', 'blocked')
      ORDER BY COALESCE(td.finished_at, td.updated_at) DESC, td.id ASC
      LIMIT ?
    `).all(limit) as unknown as FailedDispatchRow[];
  }

  private loadFailedSprintRuns(limit: number): FailedSprintRunRow[] {
    return this.db.prepare(`
      SELECT sr.id, sr.project_id, p.name AS project_name, sr.sprint_id,
        s.name AS sprint_name, s.number AS sprint_number, sr.id AS sprint_run_id,
        NULL AS task_id, NULL AS task_key, NULL AS task_title,
        sr.created_at, sr.finished_at, sr.updated_at
      FROM sprint_runs sr
      INNER JOIN projects p ON p.id = sr.project_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.status = 'failed'
      ORDER BY COALESCE(sr.finished_at, sr.updated_at) DESC, sr.id ASC
      LIMIT ?
    `).all(limit) as unknown as FailedSprintRunRow[];
  }

  private loadExecutionEvents(limit: number): ExecutionEventRow[] {
    return this.db.prepare(`
      SELECT * FROM (
        SELECT tre.id, 'task_run_event' AS source_type, tr.project_id, p.name AS project_name,
          tr.sprint_id, s.name AS sprint_name, s.number AS sprint_number, tr.sprint_run_id,
          tr.task_id, t.task_key, t.title AS task_title, tre.task_run_id, tr.dispatch_id,
          tre.event_type, tre.originator, tre.payload_json, tre.created_at
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        INNER JOIN projects p ON p.id = tr.project_id
        INNER JOIN sprints s ON s.id = tr.sprint_id
        INNER JOIN tasks t ON t.id = tr.task_id
        WHERE tre.event_type IN (
          'dispatch_error', 'dispatch_failed', 'cli_error', 'cli_workflow_failed',
          'jules_pause_request_failed', 'jules_stop_request_failed', 'action_required_auto_failed'
        )
        UNION ALL
        SELECT sre.id, 'sprint_run_event' AS source_type, sr.project_id, p.name AS project_name,
          sr.sprint_id, s.name AS sprint_name, s.number AS sprint_number, sr.id AS sprint_run_id,
          NULL AS task_id, NULL AS task_key, NULL AS task_title, NULL AS task_run_id, NULL AS dispatch_id,
          sre.event_type, sre.originator, sre.payload_json, sre.created_at
        FROM sprint_run_events sre
        INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
        INNER JOIN projects p ON p.id = sr.project_id
        INNER JOIN sprints s ON s.id = sr.sprint_id
        WHERE sre.event_type IN ('sprint_run_error', 'sprint_cancelled', 'sprint_paused')
          AND (sre.event_type = 'sprint_run_error' OR COALESCE(sre.originator, 'system') != 'user')
      ) events
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(limit) as unknown as ExecutionEventRow[];
  }

  private mapAttention(row: AttentionNotificationRow): Candidate {
    const title = sanitizeText(row.title, "Intervention required");
    const reason = sanitizeText(row.summary_markdown, title);
    return {
      ...toBase(row, {
        id: `attention:${row.id}`,
        kind: "human_intervention",
        severity: severity(row.severity),
        title,
        summary: reason,
        reason,
        instructions: attentionInstructions(row.attention_type),
        attentionItemId: row.id,
        createdAt: row.opened_at,
        updatedAt: row.updated_at,
        source: {
          type: "attention_item",
          id: row.id,
          eventType: row.attention_type,
          sprintRunId: row.sprint_run_id,
          taskRunId: null,
          dispatchId: row.dispatch_id,
          attentionOwnerType: row.owner_type as ProjectAttentionOwnerType,
          attentionStatus: row.status as Extract<ProjectAttentionStatus, "open" | "claimed">,
        },
      }),
      dedupeKey: `attention:${row.id}`,
    };
  }

  private mapFailedDispatch(row: FailedDispatchRow): Candidate {
    const taskLabel = row.task_key || row.task_title || "Task";
    const reason = sanitizeText(row.error_message, `${taskLabel} execution failed.`);
    const updatedAt = row.finished_at || row.updated_at;
    return {
      ...toBase(row, {
        id: `dispatch:${row.id}:failed`,
        kind: "task_execution_failed",
        severity: "high",
        title: `${taskLabel} execution failed`,
        summary: reason,
        reason,
        instructions: "Review the task execution details, correct the failure, and retry or resume the task.",
        attentionItemId: null,
        createdAt: updatedAt,
        updatedAt,
        source: {
          type: "task_dispatch",
          id: row.id,
          eventType: "dispatch_failed",
          sprintRunId: row.sprint_run_id,
          taskRunId: null,
          dispatchId: row.id,
          attentionOwnerType: null,
          attentionStatus: null,
        },
      }),
      dedupeKey: `${scopeKey(row)}:failure`,
    };
  }

  private mapFailedSprintRun(row: FailedSprintRunRow): Candidate {
    const updatedAt = row.finished_at || row.updated_at;
    const sprintLabel = row.sprint_name || "Sprint";
    return {
      ...toBase(row, {
        id: `sprint-run:${row.id}:failed`,
        kind: "sprint_execution_failed",
        severity: "critical",
        title: `${sprintLabel} execution failed`,
        summary: "Sprint execution ended in a failed state.",
        reason: "Sprint execution ended in a failed state.",
        instructions: "Review the sprint timeline and failed tasks, correct the root cause, and restart or resume execution.",
        attentionItemId: null,
        createdAt: row.created_at,
        updatedAt,
        source: {
          type: "sprint_run",
          id: row.id,
          eventType: "sprint_failed",
          sprintRunId: row.id,
          taskRunId: null,
          dispatchId: null,
          attentionOwnerType: null,
          attentionStatus: null,
        },
      }),
      dedupeKey: `${scopeKey(row)}:failure`,
    };
  }

  private mapExecutionEvent(row: ExecutionEventRow): Candidate {
    const automaticStop = row.event_type === "sprint_cancelled" || row.event_type === "sprint_paused";
    const kind: DashboardNotificationKind = automaticStop ? "sprint_automatically_stopped" : "system_execution_error";
    const fallback = automaticStop
      ? "System automation stopped this sprint."
      : "A system execution error requires review.";
    const reason = parseSafeReason(row.payload_json, fallback);
    return {
      ...toBase(row, {
        id: `event:${row.source_type}:${row.id}`,
        kind,
        severity: automaticStop ? "medium" : "high",
        title: automaticStop ? "Sprint automatically stopped" : "System execution error",
        summary: reason,
        reason,
        instructions: automaticStop
          ? "Review why automation stopped the sprint, then resume or restart it when safe."
          : "Review the linked execution context, correct the system error, and retry the affected work.",
        attentionItemId: null,
        createdAt: row.created_at,
        updatedAt: row.created_at,
        source: {
          type: row.source_type,
          id: row.id,
          eventType: row.event_type,
          sprintRunId: row.sprint_run_id,
          taskRunId: row.task_run_id,
          dispatchId: row.dispatch_id,
          attentionOwnerType: null,
          attentionStatus: null,
        },
      }),
      dedupeKey: `${scopeKey(row)}:${automaticStop ? "automatic-stop" : "failure"}`,
    };
  }
}
