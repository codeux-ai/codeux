import type { Logger } from "../shared/logging/logger.js";
import type { AppDbStorage } from "../repositories/app-db-storage.js";
import type { DatabaseAdapter } from "../repositories/db/database-adapter.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";

const DEFAULT_RETENTION_DAYS = 14;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3_650;
const PROVIDER_ACTIVITY_DETAIL_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_MAINTENANCE_ROWS_PER_TABLE = 500;
const MAX_INCREMENTAL_VACUUM_PAGES = 256;

interface RowIdRow {
  row_id: number;
}

interface DatabasePruneResult {
  taskRunsDeleted: number;
  executionInvocationsDeleted: number;
  providerInvocationsDeleted: number;
  attentionItemsDeleted: number;
  realtimeEventsDeleted: number;
  virtualWorkerAssignmentsDeleted: number;
  providerActivitiesDeleted: number;
  providerSessionsDeleted: number;
  staleProviderSessionsRecovered: number;
}

export interface DatabaseMaintenanceResult {
  prunedTaskRuns: number;
  prunedExecutionInvocations: number;
  prunedProviderInvocations: number;
  prunedAttentionItems: number;
  prunedRealtimeEvents: number;
  prunedVirtualWorkerAssignments: number;
  prunedProviderActivities: number;
  prunedProviderSessions: number;
  recoveredStaleProviderSessions: number;
  pruningFailed: boolean;
  pruningSkipped: boolean;
  vacuumFailed: boolean;
  vacuumSkipped: boolean;
  checkpointFailures: string[];
  checkpointSkipped: boolean;
}

export interface DatabaseMaintenanceServiceDeps {
  appDbStorage: AppDbStorage;
  sessionTracking: SessionTrackingRepository;
  settingsRepository: SettingsRepository;
  logger: Logger;
}

export class DatabaseMaintenanceService {
  private readonly scanCursors = new Map<string, number>();

  constructor(private readonly deps: DatabaseMaintenanceServiceDeps) {}

  /**
   * Runs one bounded startup maintenance pass. Provider work always wins: all write-heavy
   * maintenance and checkpoints are deferred when an invocation is already running.
   */
  async runMaintenance(): Promise<DatabaseMaintenanceResult> {
    const runtime = this.deps.settingsRepository.getSystemSettings().runtime;
    const autoVacuum = runtime.dbAutoVacuumOnStartup ?? false;
    const pruningEnabled = runtime.dbPruningEnabled ?? true;
    const retentionDays = this.normalizeRetentionDays(runtime.dbRetentionDays);
    const providerWorkActive = this.hasActiveProviderInvocations();

    this.deps.logger.info("Starting database maintenance...", {
      autoVacuum,
      pruningEnabled,
      retentionDays,
      providerWorkActive,
    });

    const result: DatabaseMaintenanceResult = {
      prunedTaskRuns: 0,
      prunedExecutionInvocations: 0,
      prunedProviderInvocations: 0,
      prunedAttentionItems: 0,
      prunedRealtimeEvents: 0,
      prunedVirtualWorkerAssignments: 0,
      prunedProviderActivities: 0,
      prunedProviderSessions: 0,
      recoveredStaleProviderSessions: 0,
      pruningFailed: false,
      pruningSkipped: !pruningEnabled || providerWorkActive,
      vacuumFailed: false,
      vacuumSkipped: !autoVacuum || providerWorkActive,
      checkpointFailures: [],
      checkpointSkipped: providerWorkActive,
    };

    if (pruningEnabled && !providerWorkActive) {
      try {
        this.assignPruneResult(result, this.pruneData(retentionDays));
      } catch (error) {
        result.pruningFailed = true;
        this.deps.logger.error("Failed to prune database records", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (pruningEnabled) {
      this.deps.logger.info("Skipping database pruning while provider invocations are active.");
    }

    if (autoVacuum && !providerWorkActive) {
      try {
        if (this.incrementalVacuumDatabases().length > 0) {
          result.vacuumFailed = true;
        }
      } catch (error) {
        result.vacuumFailed = true;
        this.deps.logger.error("Failed to incrementally vacuum databases", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (autoVacuum) {
      this.deps.logger.info("Skipping incremental startup vacuum while provider invocations are active.");
    }

    if (!providerWorkActive) {
      try {
        result.checkpointFailures = this.checkpointWalDatabases();
      } catch (error) {
        this.deps.logger.error("Unexpected error during WAL checkpoints", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.deps.logger.info("Database maintenance completed.", { result });
    return result;
  }

  /**
   * Advances every retention category by one bounded batch, then checkpoints WAL files. The server
   * calls this on its low-frequency maintenance timer so large histories converge gradually.
   */
  runPeriodicMaintenance(): void {
    if (this.hasActiveProviderInvocations()) {
      // PASSIVE checkpoints never wait for readers or writers. Keep the write-heavy retention
      // work deferred, but bound WAL growth for continuously busy runtimes where there may not be
      // an idle maintenance window for hours.
      this.deps.logger.debug("Skipping periodic database pruning while provider invocations are active.");
      this.checkpointWalDatabases();
      return;
    }

    const runtime = this.deps.settingsRepository.getSystemSettings().runtime;
    if (runtime.dbPruningEnabled ?? true) {
      const retentionDays = this.normalizeRetentionDays(runtime.dbRetentionDays);
      try {
        this.pruneData(retentionDays);
      } catch (error) {
        this.deps.logger.error("Periodic database pruning failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.checkpointWalDatabases();
  }

  private normalizeRetentionDays(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return DEFAULT_RETENTION_DAYS;
    }
    return Math.max(MIN_RETENTION_DAYS, Math.min(Math.floor(value), MAX_RETENTION_DAYS));
  }

  private assignPruneResult(result: DatabaseMaintenanceResult, pruned: DatabasePruneResult): void {
    result.prunedTaskRuns = pruned.taskRunsDeleted;
    result.prunedExecutionInvocations = pruned.executionInvocationsDeleted;
    result.prunedProviderInvocations = pruned.providerInvocationsDeleted;
    result.prunedAttentionItems = pruned.attentionItemsDeleted;
    result.prunedRealtimeEvents = pruned.realtimeEventsDeleted;
    result.prunedVirtualWorkerAssignments = pruned.virtualWorkerAssignmentsDeleted;
    result.prunedProviderActivities = pruned.providerActivitiesDeleted;
    result.prunedProviderSessions = pruned.providerSessionsDeleted;
    result.recoveredStaleProviderSessions = pruned.staleProviderSessionsRecovered;
  }

  private hasActiveProviderInvocations(): boolean {
    const row = this.deps.appDbStorage.getDatabase().prepare(`
      SELECT 1 AS active
      FROM provider_invocations
      WHERE status = 'running'
      LIMIT 1
    `).get() as { active?: number } | undefined;
    return row?.active === 1;
  }

  private pruneData(retentionDays: number): DatabasePruneResult {
    const retentionMs = retentionDays * 24 * 60 * 60 * 1_000;
    const thresholdDate = new Date(Date.now() - retentionMs).toISOString();
    const oneDayAgo = new Date(Date.now() - PROVIDER_ACTIVITY_DETAIL_RETENTION_MS).toISOString();
    const appDb = this.deps.appDbStorage.getDatabase();
    const sessionDb = this.deps.sessionTracking.getDatabase();

    // Remove potentially large child trees first. Parent rows are deleted only after every child
    // table is empty, so no parent deletion can trigger an unbounded foreign-key cascade.
    const invocationMessagesDeleted = this.deleteBatch({
      cursorKey: "app.execution-invocation-messages",
      db: appDb,
      table: "execution_invocation_messages",
      whereSql: `EXISTS (
        SELECT 1
        FROM execution_invocations
        WHERE execution_invocations.id = execution_invocation_messages.invocation_id
          AND execution_invocations.finished_at IS NOT NULL
          AND execution_invocations.finished_at < ?
          AND execution_invocations.preserved_at IS NULL
      )`,
      params: [thresholdDate],
    });
    const taskRunEventsDeleted = this.deleteTaskRunChildBatch(
      appDb,
      "app.task-run-events",
      "task_run_events",
      "task_run_id",
      thresholdDate,
    );
    const taskRatingsDeleted = this.deleteTaskRunChildBatch(
      appDb,
      "app.task-ratings",
      "task_self_reflection_ratings",
      "source_task_run_id",
      thresholdDate,
    );
    const qaReviewRunsDeleted = this.deleteTaskRunChildBatch(
      appDb,
      "app.qa-review-runs",
      "qa_review_runs",
      "task_run_id",
      thresholdDate,
    );
    const nodeFlowRunsDetached = this.detachExecutionInvocationBatch(
      appDb,
      "app.node-flow-runs",
      "node_flow_runs",
      thresholdDate,
    );
    const nodeFlowNodeRunsDetached = this.detachExecutionInvocationBatch(
      appDb,
      "app.node-flow-node-runs",
      "node_flow_node_runs",
      thresholdDate,
    );

    const executionInvocationsDeleted = this.deleteBatch({
      cursorKey: "app.execution-invocations",
      db: appDb,
      table: "execution_invocations",
      whereSql: `finished_at IS NOT NULL
        AND finished_at < ?
        AND preserved_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM execution_invocation_messages
          WHERE execution_invocation_messages.invocation_id = execution_invocations.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM node_flow_runs
          WHERE node_flow_runs.execution_invocation_id = execution_invocations.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM node_flow_node_runs
          WHERE node_flow_node_runs.execution_invocation_id = execution_invocations.id
        )`,
      params: [thresholdDate],
    });

    // Keep provider rows while any execution invocation still references them. This preserves the
    // durable link for retained or preserved invocations instead of relying on ON DELETE SET NULL.
    const providerInvocationsDeleted = this.deleteBatch({
      cursorKey: "app.provider-invocations",
      db: appDb,
      table: "provider_invocations",
      whereSql: `finished_at IS NOT NULL
        AND finished_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM execution_invocations
          WHERE execution_invocations.provider_invocation_id = provider_invocations.id
        )`,
      params: [thresholdDate],
    });

    const taskRunsDeleted = this.deleteBatch({
      cursorKey: "app.task-runs",
      db: appDb,
      table: "task_runs",
      whereSql: `finished_at IS NOT NULL
        AND finished_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM execution_invocations
          WHERE execution_invocations.task_run_id = task_runs.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM provider_invocations
          WHERE provider_invocations.task_run_id = task_runs.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM task_run_events
          WHERE task_run_events.task_run_id = task_runs.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM task_self_reflection_ratings
          WHERE task_self_reflection_ratings.source_task_run_id = task_runs.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM qa_review_runs
          WHERE qa_review_runs.task_run_id = task_runs.id
        )`,
      params: [thresholdDate],
    });

    // Attention rows also own invocation trees through cascading foreign keys. Wait until those
    // invocation rows have independently satisfied retention and been pruned.
    const attentionItemsDeleted = this.deleteBatch({
      cursorKey: "app.attention-items",
      db: appDb,
      table: "project_attention_items",
      whereSql: `resolved_at IS NOT NULL
        AND resolved_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM execution_invocations
          WHERE execution_invocations.attention_item_id = project_attention_items.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM provider_invocations
          WHERE provider_invocations.attention_item_id = project_attention_items.id
        )`,
      params: [thresholdDate],
    });

    const realtimeEventsDeleted = this.deleteBatch({
      cursorKey: "app.realtime-events",
      db: appDb,
      table: "dashboard_realtime_events",
      whereSql: "created_at < ?",
      params: [oneDayAgo],
    });
    const virtualWorkerAssignmentsDeleted = this.deleteBatch({
      cursorKey: "app.virtual-worker-assignments",
      db: appDb,
      table: "project_worker_assignments",
      whereSql: "worker_endpoint_type = 'virtual_cli' AND status = 'released'",
      params: [],
    });

    const staleProviderSessionsRecovered = this.updateBatch({
      cursorKey: "sessions.stale-provider-sessions",
      db: sessionDb,
      table: "provider_sessions",
      setSql: "state = 'CANCELLED'",
      whereSql: "state = 'RUNNING' AND provider != 'jules' AND update_time < ?",
      params: [thresholdDate],
    });
    const providerActivitiesDeleted = this.deleteBatch({
      cursorKey: "sessions.provider-activities",
      db: sessionDb,
      table: "provider_activities",
      whereSql: `EXISTS (
        SELECT 1
        FROM provider_sessions
        WHERE provider_sessions.id = provider_activities.session_id
          AND provider_sessions.update_time < ?
          AND provider_sessions.state != 'RUNNING'
      )`,
      params: [oneDayAgo],
    });
    const providerSessionsDeleted = this.deleteBatch({
      cursorKey: "sessions.provider-sessions",
      db: sessionDb,
      table: "provider_sessions",
      whereSql: `update_time < ?
        AND state != 'RUNNING'
        AND NOT EXISTS (
          SELECT 1
          FROM provider_activities
          WHERE provider_activities.session_id = provider_sessions.id
        )`,
      params: [thresholdDate],
    });

    const result: DatabasePruneResult = {
      taskRunsDeleted,
      executionInvocationsDeleted,
      providerInvocationsDeleted,
      attentionItemsDeleted,
      realtimeEventsDeleted,
      virtualWorkerAssignmentsDeleted,
      providerActivitiesDeleted,
      providerSessionsDeleted,
      staleProviderSessionsRecovered,
    };
    this.deps.logger.info("Pruned bounded database record batches", {
      ...result,
      invocationMessagesDeleted,
      taskRunEventsDeleted,
      taskRatingsDeleted,
      qaReviewRunsDeleted,
      nodeFlowRunsDetached,
      nodeFlowNodeRunsDetached,
      maxRowsPerTable: MAX_MAINTENANCE_ROWS_PER_TABLE,
    });
    return result;
  }

  private deleteTaskRunChildBatch(
    db: DatabaseAdapter,
    cursorKey: string,
    table: string,
    taskRunColumn: string,
    thresholdDate: string,
  ): number {
    return this.deleteBatch({
      cursorKey,
      db,
      table,
      whereSql: `EXISTS (
        SELECT 1
        FROM task_runs
        WHERE task_runs.id = ${table}.${taskRunColumn}
          AND task_runs.finished_at IS NOT NULL
          AND task_runs.finished_at < ?
          AND NOT EXISTS (
            SELECT 1
            FROM execution_invocations
            WHERE execution_invocations.task_run_id = task_runs.id
              AND execution_invocations.preserved_at IS NOT NULL
          )
      )`,
      params: [thresholdDate],
    });
  }

  private detachExecutionInvocationBatch(
    db: DatabaseAdapter,
    cursorKey: string,
    table: string,
    thresholdDate: string,
  ): number {
    return this.updateBatch({
      cursorKey,
      db,
      table,
      setSql: "execution_invocation_id = NULL",
      whereSql: `execution_invocation_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM execution_invocations
          WHERE execution_invocations.id = ${table}.execution_invocation_id
            AND execution_invocations.finished_at IS NOT NULL
            AND execution_invocations.finished_at < ?
            AND execution_invocations.preserved_at IS NULL
        )`,
      params: [thresholdDate],
    });
  }

  private deleteBatch(args: {
    cursorKey: string;
    db: DatabaseAdapter;
    table: string;
    whereSql: string;
    params: unknown[];
  }): number {
    return this.mutateBatch({
      ...args,
      buildSql: (placeholders) => `
        DELETE FROM ${args.table}
        WHERE rowid IN (${placeholders})
          AND (${args.whereSql})
      `,
    });
  }

  private updateBatch(args: {
    cursorKey: string;
    db: DatabaseAdapter;
    table: string;
    setSql: string;
    whereSql: string;
    params: unknown[];
  }): number {
    return this.mutateBatch({
      ...args,
      buildSql: (placeholders) => `
        UPDATE ${args.table}
        SET ${args.setSql}
        WHERE rowid IN (${placeholders})
          AND (${args.whereSql})
      `,
    });
  }

  private mutateBatch(args: {
    cursorKey: string;
    db: DatabaseAdapter;
    table: string;
    params: unknown[];
    buildSql: (placeholders: string) => string;
  }): number {
    const cursor = this.scanCursors.get(args.cursorKey) ?? 0;
    const candidates = args.db.prepare(`
      SELECT rowid AS row_id
      FROM ${args.table}
      WHERE rowid > ?
      ORDER BY rowid ASC
      LIMIT ?
    `).all(cursor, MAX_MAINTENANCE_ROWS_PER_TABLE) as unknown as RowIdRow[];

    if (candidates.length === 0) {
      this.scanCursors.set(args.cursorKey, 0);
      return 0;
    }

    const rowIds = candidates.map((candidate) => candidate.row_id);
    const lastRowId = rowIds[rowIds.length - 1];
    this.scanCursors.set(
      args.cursorKey,
      candidates.length < MAX_MAINTENANCE_ROWS_PER_TABLE ? 0 : lastRowId,
    );
    const placeholders = rowIds.map(() => "?").join(", ");
    return args.db.prepare(args.buildSql(placeholders)).run(...rowIds, ...args.params).changes;
  }

  /**
   * Checkpoints each database without forcing active readers or writers through a TRUNCATE barrier.
   * The server invokes this only after confirming that no provider invocation is running.
   */
  checkpointWalDatabases(): string[] {
    const failures: string[] = [];
    const targets = this.databaseTargets();
    for (const target of targets) {
      try {
        target.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
      } catch (error) {
        failures.push(target.label);
        this.deps.logger.warn("WAL checkpoint failed", {
          database: target.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }

  /**
   * Reclaims at most a fixed number of freelist pages per database. SQLite treats this as a no-op
   * for legacy databases that are not in incremental auto-vacuum mode; automatic maintenance never
   * falls back to the unbounded full-file VACUUM operation.
   */
  private incrementalVacuumDatabases(): string[] {
    const failures: string[] = [];
    for (const target of this.databaseTargets()) {
      try {
        this.deps.logger.info(`Executing bounded incremental vacuum on ${target.label}...`, {
          maxPages: MAX_INCREMENTAL_VACUUM_PAGES,
        });
        target.db.exec(`PRAGMA incremental_vacuum(${MAX_INCREMENTAL_VACUUM_PAGES});`);
      } catch (error) {
        failures.push(target.label);
        this.deps.logger.error(`Failed to incrementally vacuum ${target.label}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }

  private databaseTargets(): Array<{ label: string; db: DatabaseAdapter }> {
    return [
      { label: "app.db", db: this.deps.appDbStorage.getDatabase() },
      { label: "session-tracking.db", db: this.deps.sessionTracking.getDatabase() },
      { label: "settings.db", db: this.deps.settingsRepository.getDatabase() },
    ];
  }
}
