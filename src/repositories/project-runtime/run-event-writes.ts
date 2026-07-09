import { randomUUID } from "crypto";
import type { Subtask } from "../../contracts/app-types.js";
import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { TaskRow, TaskRunRow, TaskRunState } from "./runtime-status-projection.js";

const TERMINAL_TASK_STATES = new Set<TaskRunState>(["CODING_COMPLETED", "COMPLETED", "FAILED", "BLOCKED", "QA_REVIEW_FAILED"]);

function subtaskSignature(subtask: Subtask): string {
  return JSON.stringify({
    status: subtask.status || "PENDING",
    provider: subtask.provider || null,
    sessionId: subtask.session_id || null,
    sessionName: subtask.session_name || null,
    workerBranch: subtask.worker_branch || null,
    prUrl: subtask.pr_url || null,
    isMerged: Boolean(subtask.is_merged),
    mergeIndicator: subtask.merge_indicator || null,
  });
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function buildSessionIdentityCandidates(sessionId?: string | null, sessionName?: string | null): string[] {
  const candidates = new Set<string>();
  for (const value of [sessionId, sessionName]) {
    const normalized = nonEmptyString(value);
    if (!normalized) {
      continue;
    }
    candidates.add(normalized);
    const raw = normalized.replace(/^sessions\//, "");
    if (raw) {
      candidates.add(raw);
      candidates.add(`sessions/${raw}`);
    }
  }
  return [...candidates];
}

export function toPersistedTaskRunState(status: TaskRunState): Exclude<TaskRunState, "CODING_COMPLETED" | "QA_REVIEW_FAILED"> {
  // `QA_REVIEW_FAILED` is a task/planning state, not a provider-run state: the
  // underlying session genuinely COMPLETED (that is what QA reviewed). Persist
  // the run as COMPLETED so the task_runs.state column stays within the valid
  // execution-state set; the escalation lives on the task row, not the run.
  if (status === "CODING_COMPLETED" || status === "QA_REVIEW_FAILED") {
    return "COMPLETED";
  }
  return status;
}

export function shouldPreserveCompletedSessionState(existing: TaskRunRow | null, subtask: Subtask): boolean {
  if (!existing || existing.state !== "COMPLETED" || subtask.status !== "RUNNING") {
    return false;
  }
  if (subtask.session_state !== "COMPLETED") {
    return false;
  }
  return Boolean(
    nonEmptyString(subtask.pr_url)
    || nonEmptyString(subtask.worker_branch)
    || nonEmptyString(subtask.merge_indicator),
  );
}

export class RunEventWrites {
  constructor(private readonly db: DatabaseAdapter) {}

  syncTaskRun(
    task: TaskRow,
    subtask: Subtask,
    now: string,
    candidateRun?: TaskRunRow | null,
    effectiveRuntimeState?: TaskRunState,
  ): void {
    const runtimeState = effectiveRuntimeState || subtask.status || "PENDING";
    const persistedRunState = toPersistedTaskRunState(runtimeState);
    const existing = candidateRun === undefined ? this.findCandidateRun(task.id, subtask) : candidateRun;
    const signature = subtaskSignature({
      ...subtask,
      status: persistedRunState,
    });

    if (!existing) {
      if (!this.shouldCreateTaskRun(subtask)) {
        return;
      }

      const runId = randomUUID();
      this.db.prepare(`
        INSERT INTO task_runs (
          id, project_id, sprint_id, task_id, connection_id, provider, mode, session_id, session_name,
          state, worker_branch, pr_url, started_at, finished_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        task.project_id,
        task.sprint_id,
        task.id,
        null,
        subtask.provider || null,
        "legacy-orchestrator",
        subtask.session_id || null,
        subtask.session_name || null,
        persistedRunState,
        subtask.worker_branch || null,
        subtask.pr_url || null,
        persistedRunState === "PENDING" ? null : now,
        TERMINAL_TASK_STATES.has(runtimeState) ? now : null,
        null
      );
      this.insertRunEvent({
        taskRunId: runId,
        eventType: "status_sync",
        payload: { signature },
        createdAt: now,
      });
      return;
    }

    const previousSignature = JSON.stringify({
      status: existing.state,
      provider: existing.provider,
      sessionId: existing.session_id,
      sessionName: existing.session_name,
      workerBranch: existing.worker_branch,
      prUrl: existing.pr_url,
      isMerged: Boolean(subtask.is_merged),
      mergeIndicator: subtask.merge_indicator || null,
    });

    const startedAt = existing.started_at || (runtimeState === "PENDING" ? null : now);
    const finishedAt = TERMINAL_TASK_STATES.has(runtimeState)
      ? (existing.finished_at || now)
      : null;
    const incomingPrUrl = nonEmptyString(subtask.pr_url);
    const existingPrUrl = nonEmptyString(existing.pr_url);
    const preservesSameRuntime =
      runtimeState !== "PENDING"
      && existingPrUrl
      && (
        (nonEmptyString(subtask.session_id) && nonEmptyString(subtask.session_id) === nonEmptyString(existing.session_id))
        || (nonEmptyString(subtask.session_name) && nonEmptyString(subtask.session_name) === nonEmptyString(existing.session_name))
        || (nonEmptyString(subtask.worker_branch) && nonEmptyString(subtask.worker_branch) === nonEmptyString(existing.worker_branch))
      );
    const prUrl = incomingPrUrl || (preservesSameRuntime ? existingPrUrl : null);

    this.db.prepare(`
      UPDATE task_runs
      SET provider = ?, mode = ?, session_id = ?, session_name = ?, state = ?, worker_branch = ?, pr_url = ?,
          started_at = ?, finished_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(
      subtask.provider || existing.provider || null,
      existing.mode || "legacy-orchestrator",
      subtask.session_id || existing.session_id || null,
      subtask.session_name || existing.session_name || null,
      persistedRunState,
      subtask.worker_branch || null,
      prUrl,
      startedAt,
      finishedAt,
      startedAt && finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
      existing.id
    );

    if (previousSignature !== signature) {
      this.insertRunEvent({
        taskRunId: existing.id,
        eventType: "status_sync",
        payload: {
          previousSignature,
          signature,
        },
        createdAt: now,
      });
    }
  }

  findCandidateRun(taskId: string, subtask: Subtask): TaskRunRow | null {
    if (typeof subtask.session_id === "string" && subtask.session_id.trim().length > 0) {
      const row = this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ? AND session_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, subtask.session_id.trim()) as TaskRunRow | undefined;
      if (row) {
        return row;
      }
    }

    if (typeof subtask.session_name === "string" && subtask.session_name.trim().length > 0) {
      const row = this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ? AND session_name = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, subtask.session_name.trim()) as TaskRunRow | undefined;
      if (row) {
        return row;
      }
    }

    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE task_id = ? AND finished_at IS NULL
      ORDER BY rowid DESC
      LIMIT 1
    `).get(taskId) as TaskRunRow | undefined;
    if (row) {
      return row;
    }

    // A task can re-sync in a terminal state with no session id, for example a
    // task parked BLOCKED by the coding guardrail. Reuse the latest run already
    // in this terminal state so status sync remains idempotent.
    const persistedState = toPersistedTaskRunState(subtask.status || "PENDING");
    if (TERMINAL_TASK_STATES.has(persistedState)) {
      const terminalRow = this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ? AND state = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, persistedState) as TaskRunRow | undefined;
      if (terminalRow) {
        return terminalRow;
      }
    }

    return null;
  }

  insertRunEvent(input: {
    taskRunId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: string;
    originator?: string;
    sourceEventKey?: string | null;
  }): boolean {
    // project_id is denormalized from the parent task_run (PK lookup, negligible cost) so the live
    // execution feed can read a project's recent events straight off idx_task_run_events_project_created.
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_run_events (
        id, task_run_id, project_id, event_type, originator, payload_json, source_event_key, created_at
      )
      VALUES (?, ?, (SELECT project_id FROM task_runs WHERE id = ?), ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.taskRunId,
      input.taskRunId,
      input.eventType,
      input.originator ?? "system",
      JSON.stringify(input.payload),
      input.sourceEventKey ?? null,
      input.createdAt
    );
    return Number((result as { changes?: number }).changes || 0) > 0;
  }

  private shouldCreateTaskRun(subtask: Subtask): boolean {
    const hasRuntimeEvidence = Boolean(
      (subtask.session_id && subtask.session_id.trim().length > 0)
      || (subtask.session_name && subtask.session_name.trim().length > 0)
      || (subtask.provider && subtask.provider.trim().length > 0)
      || (subtask.worker_branch && subtask.worker_branch.trim().length > 0)
      || (subtask.pr_url && subtask.pr_url.trim().length > 0)
    );

    if (subtask.status === "BLOCKED" && !hasRuntimeEvidence) {
      return false;
    }

    return Boolean(hasRuntimeEvidence || (subtask.status && subtask.status !== "PENDING"));
  }
}
