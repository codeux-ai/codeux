import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";

export type QaReviewTriggerType = "task_completion" | "completed_task_without_pr" | "sprint_completion";
export type QaReviewRunStatus = "running" | "completed" | "failed" | "skipped" | "errored";
export type QaReviewOutcome = "pass" | "changes_requested" | "skipped";

export interface QaReviewRunRecord {
  id: string;
  projectId: string;
  sprintId: string;
  sprintRunId: string | null;
  taskId: string | null;
  taskRunId: string | null;
  triggerType: QaReviewTriggerType;
  status: QaReviewRunStatus;
  outcome: QaReviewOutcome | null;
  runIndex: number;
  agentPresetId: string | null;
  agentName: string | null;
  targetTaskKey: string | null;
  targetSessionId: string | null;
  targetProvider: string | null;
  summaryMarkdown: string | null;
  fixInstructions: string | null;
  payload: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface QaReviewRunRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_run_id: string | null;
  task_id: string | null;
  task_run_id: string | null;
  trigger_type: string;
  status: string;
  outcome: string | null;
  run_index: number;
  agent_preset_id: string | null;
  agent_name: string | null;
  target_task_key: string | null;
  target_session_id: string | null;
  target_provider: string | null;
  summary_markdown: string | null;
  fix_instructions: string | null;
  payload_json: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class QaReviewRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  createRun(input: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string | null;
    taskId?: string | null;
    taskRunId?: string | null;
    triggerType: QaReviewTriggerType;
    runIndex: number;
    agentPresetId?: string | null;
    agentName?: string | null;
    targetTaskKey?: string | null;
    targetSessionId?: string | null;
    targetProvider?: string | null;
    payload?: Record<string, unknown> | null;
    startedAt?: string;
  }): QaReviewRunRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const startedAt = input.startedAt || now;

    this.db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, sprint_run_id, task_id, task_run_id, trigger_type, status, outcome, run_index,
        agent_preset_id, agent_name, target_task_key, target_session_id, target_provider, summary_markdown,
        fix_instructions, payload_json, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.sprintRunId ?? null,
      input.taskId ?? null,
      input.taskRunId ?? null,
      input.triggerType,
      input.runIndex,
      input.agentPresetId ?? null,
      input.agentName ?? null,
      input.targetTaskKey ?? null,
      input.targetSessionId ?? null,
      input.targetProvider ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      startedAt,
      now,
      now,
    );

    return this.requireRun(id);
  }

  updateRun(runId: string, input: {
    status?: QaReviewRunStatus;
    outcome?: QaReviewOutcome | null;
    targetTaskKey?: string | null;
    targetSessionId?: string | null;
    targetProvider?: string | null;
    summaryMarkdown?: string | null;
    fixInstructions?: string | null;
    payload?: Record<string, unknown> | null;
    finishedAt?: string | null;
  }): QaReviewRunRecord {
    const current = this.requireRun(runId);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE qa_review_runs
      SET status = ?, outcome = ?, target_task_key = ?, target_session_id = ?, target_provider = ?,
          summary_markdown = ?, fix_instructions = ?, payload_json = ?, finished_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status ?? current.status,
      input.outcome === undefined ? current.outcome : input.outcome,
      input.targetTaskKey === undefined ? current.targetTaskKey : input.targetTaskKey,
      input.targetSessionId === undefined ? current.targetSessionId : input.targetSessionId,
      input.targetProvider === undefined ? current.targetProvider : input.targetProvider,
      input.summaryMarkdown === undefined ? current.summaryMarkdown : input.summaryMarkdown,
      input.fixInstructions === undefined ? current.fixInstructions : input.fixInstructions,
      input.payload === undefined
        ? JSON.stringify(current.payload)
        : (input.payload ? JSON.stringify(input.payload) : null),
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      now,
      runId,
    );

    return this.requireRun(runId);
  }

  countTaskRuns(taskId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM qa_review_runs
      WHERE task_id = ?
        AND trigger_type IN ('task_completion', 'completed_task_without_pr')
        AND status IN ('completed', 'failed')
    `).get(taskId) as { count?: number | string } | undefined;

    return row ? Number(row.count || 0) : 0;
  }

  /**
   * Clear a task's per-task QA review history so an explicit rerun starts with a
   * fresh verdict budget. Without this, the fail-closed merge gate would see the
   * previous attempt's exhausted/changes-requested runs and immediately re-block
   * or escalate the fresh attempt before it can even be reviewed. Sprint-level
   * runs are left untouched. Returns the number of runs cleared.
   */
  resetTaskReviewRuns(taskId: string): number {
    const info = this.db.prepare(`
      DELETE FROM qa_review_runs
      WHERE task_id = ?
        AND trigger_type IN ('task_completion', 'completed_task_without_pr')
    `).run(taskId);
    return Number(info.changes || 0);
  }

  /**
   * Count only QA runs that reached a real verdict (`completed`). Runs that
   * `failed` for infrastructure reasons — the QA reviewer crashing on missing
   * auth/config, a container error, an unparseable response — produced no
   * judgement about the task and must not consume the verdict retry budget.
   * Otherwise a single flaky reviewer error would exhaust QA and let a task
   * settle without ever having been reviewed. Use this for the merge-gate
   * exhaustion decision; {@link countTaskRuns} (which includes infra failures)
   * bounds total attempts so a permanently broken reviewer still escalates.
   */
  countDecisiveTaskRuns(taskId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM qa_review_runs
      WHERE task_id = ?
        AND trigger_type IN ('task_completion', 'completed_task_without_pr')
        AND status = 'completed'
    `).get(taskId) as { count?: number | string } | undefined;

    return row ? Number(row.count || 0) : 0;
  }

  getLatestTaskRun(taskId: string): QaReviewRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM qa_review_runs
      WHERE task_id = ?
        AND trigger_type IN ('task_completion', 'completed_task_without_pr')
      ORDER BY started_at DESC
      LIMIT 1
    `).get(taskId) as QaReviewRunRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getLatestSprintRun(sprintId: string): QaReviewRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM qa_review_runs
      WHERE sprint_id = ?
        AND trigger_type = 'sprint_completion'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(sprintId) as QaReviewRunRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  hasSprintReviewRun(sprintId: string): boolean {
    return Boolean(this.getLatestSprintRun(sprintId)?.id);
  }

  listRunsForTask(taskId: string): QaReviewRunRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM qa_review_runs
      WHERE task_id = ?
      ORDER BY started_at DESC
    `).all(taskId) as unknown as QaReviewRunRow[];

    return rows.map((row) => this.mapRow(row));
  }

  listRunningRuns(): QaReviewRunRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM qa_review_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
    `).all() as unknown as QaReviewRunRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getRun(runId: string): QaReviewRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM qa_review_runs
      WHERE id = ?
    `).get(runId) as QaReviewRunRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private requireRun(runId: string): QaReviewRunRecord {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`QA review run not found: ${runId}`);
    }
    return run;
  }

  private mapRow(row: QaReviewRunRow): QaReviewRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintRunId: row.sprint_run_id,
      taskId: row.task_id,
      taskRunId: row.task_run_id,
      triggerType: row.trigger_type as QaReviewTriggerType,
      status: row.status as QaReviewRunStatus,
      outcome: row.outcome as QaReviewOutcome | null,
      runIndex: Number(row.run_index),
      agentPresetId: row.agent_preset_id,
      agentName: row.agent_name,
      targetTaskKey: row.target_task_key,
      targetSessionId: row.target_session_id,
      targetProvider: row.target_provider,
      summaryMarkdown: row.summary_markdown,
      fixInstructions: row.fix_instructions,
      payload: parsePayload(row.payload_json),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
