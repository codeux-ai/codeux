import type { Logger } from "../shared/logging/logger.js";
import type { AppDbStorage } from "../repositories/app-db-storage.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";

export interface DatabaseMaintenanceResult {
  prunedTaskRuns: number;
  prunedAttentionItems: number;
  prunedRealtimeEvents: number;
  prunedProviderActivities: number;
  prunedProviderSessions: number;
  pruningFailed: boolean;
  pruningSkipped: boolean;
  vacuumFailed: boolean;
  vacuumSkipped: boolean;
  checkpointFailures: string[];
}

export interface DatabaseMaintenanceServiceDeps {
  appDbStorage: AppDbStorage;
  sessionTracking: SessionTrackingRepository;
  settingsRepository: SettingsRepository;
  logger: Logger;
}

export class DatabaseMaintenanceService {
  constructor(private readonly deps: DatabaseMaintenanceServiceDeps) {}

  /**
   * Executes the pruning and vacuuming routines according to the system configuration.
   */
  async runMaintenance(): Promise<DatabaseMaintenanceResult> {
    const settings = this.deps.settingsRepository.getSystemSettings();
    const runtime = settings.runtime;

    const autoVacuum = runtime.dbAutoVacuumOnStartup ?? true;
    const pruningEnabled = runtime.dbPruningEnabled ?? true;

    // Clamp retention days to safe bounds (1 to 3650 days) in case of direct invalid DB states
    let rawRetentionDays = runtime.dbRetentionDays ?? 14;
    if (typeof rawRetentionDays !== "number" || !Number.isFinite(rawRetentionDays) || rawRetentionDays <= 0) {
      rawRetentionDays = 14;
    }
    const retentionDays = Math.max(1, Math.min(Math.floor(rawRetentionDays), 3650));

    this.deps.logger.info("Starting database maintenance...", {
      autoVacuum,
      pruningEnabled,
      retentionDays,
    });

    const result: DatabaseMaintenanceResult = {
      prunedTaskRuns: 0,
      prunedAttentionItems: 0,
      prunedRealtimeEvents: 0,
      prunedProviderActivities: 0,
      prunedProviderSessions: 0,
      pruningFailed: false,
      pruningSkipped: !pruningEnabled,
      vacuumFailed: false,
      vacuumSkipped: !autoVacuum,
      checkpointFailures: [],
    };

    if (pruningEnabled) {
      try {
        const pruneResult = this.pruneData(retentionDays);
        result.prunedTaskRuns = pruneResult.taskRunsDeleted;
        result.prunedAttentionItems = pruneResult.attentionItemsDeleted;
        result.prunedRealtimeEvents = pruneResult.realtimeEventsDeleted;
        result.prunedProviderActivities = pruneResult.providerActivitiesDeleted;
        result.prunedProviderSessions = pruneResult.providerSessionsDeleted;
      } catch (error) {
        result.pruningFailed = true;
        this.deps.logger.error("Failed to prune database records", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (autoVacuum) {
      try {
        const vacuumFailures = this.vacuumDatabases();
        if (vacuumFailures.length > 0) {
          result.vacuumFailed = true;
        }
      } catch (error) {
        result.vacuumFailed = true;
        this.deps.logger.error("Failed to vacuum databases", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      result.checkpointFailures = this.checkpointWalDatabases();
    } catch (error) {
      this.deps.logger.error("Unexpected error during WAL checkpoints", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.deps.logger.info("Database maintenance completed.", { result });
    return result;
  }

  private pruneData(retentionDays: number): { taskRunsDeleted: number; attentionItemsDeleted: number; realtimeEventsDeleted: number; providerActivitiesDeleted: number; providerSessionsDeleted: number; } {
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(Date.now() - retentionMs).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const appDb = this.deps.appDbStorage.getDatabase();
    const sessionDb = this.deps.sessionTracking.getDatabase();

    // 1. Prune app.db completed/failed task runs
    this.deps.logger.debug(`Pruning completed/failed task runs older than ${retentionDays} days...`, { thresholdDate });
    const runPruned = appDb.prepare(`
      DELETE FROM task_runs
      WHERE finished_at IS NOT NULL AND finished_at < ?
    `).run(thresholdDate);

    // 2. Prune app.db resolved attention items
    this.deps.logger.debug(`Pruning resolved attention items older than ${retentionDays} days...`, { thresholdDate });
    const attentionPruned = appDb.prepare(`
      DELETE FROM project_attention_items
      WHERE resolved_at IS NOT NULL AND resolved_at < ?
    `).run(thresholdDate);

    // 3. Prune app.db stale realtime events (older than 1 day)
    this.deps.logger.debug("Pruning stale dashboard realtime events...", { oneDayAgo });
    const eventsPruned = appDb.prepare(`
      DELETE FROM dashboard_realtime_events
      WHERE created_at < ?
    `).run(oneDayAgo);

    // 4. Prune session-tracking.db completed/failed sessions and their activities
    this.deps.logger.debug(`Pruning provider sessions and activities older than ${retentionDays} days...`, { thresholdDate });
    
    // First, delete activities belonging to the old sessions
    const activitiesPruned = sessionDb.prepare(`
      DELETE FROM provider_activities
      WHERE session_id IN (
        SELECT id FROM provider_sessions
        WHERE update_time < ? AND state != 'RUNNING'
      )
    `).run(thresholdDate);

    const sessionsPruned = sessionDb.prepare(`
      DELETE FROM provider_sessions
      WHERE update_time < ? AND state != 'RUNNING'
    `).run(thresholdDate);

    const result = {
      taskRunsDeleted: runPruned.changes,
      attentionItemsDeleted: attentionPruned.changes,
      realtimeEventsDeleted: eventsPruned.changes,
      providerActivitiesDeleted: activitiesPruned.changes,
      providerSessionsDeleted: sessionsPruned.changes,
    };
    this.deps.logger.info("Pruned old database records successfully", result);
    return result;
  }

  /**
   * Truncates each database's write-ahead log back into the main file. SQLite only resets the WAL
   * high-water mark on a TRUNCATE checkpoint; without periodic checkpoints a long-lived process lets
   * the WAL grow to hundreds of MB (observed: a 39MB session-tracking.db with a 267MB WAL), which
   * bloats memory/disk and slows every read. Cheap and non-destructive — a checkpoint that cannot
   * complete (busy) is a no-op rather than an error, so this is safe to call on a timer.
   */
  checkpointWalDatabases(): string[] {
    const failures: string[] = [];
    const targets: Array<{ label: string; db: { exec: (sql: string) => void } }> = [
      { label: "app.db", db: this.deps.appDbStorage.getDatabase() },
      { label: "session-tracking.db", db: this.deps.sessionTracking.getDatabase() },
      { label: "settings.db", db: this.deps.settingsRepository.getDatabase() },
    ];
    for (const target of targets) {
      try {
        target.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
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

  private vacuumDatabases(): string[] {
    const failures: string[] = [];
    const targets: Array<{ label: string; db: { exec: (sql: string) => void } }> = [
      { label: "app.db", db: this.deps.appDbStorage.getDatabase() },
      { label: "session-tracking.db", db: this.deps.sessionTracking.getDatabase() },
      { label: "settings.db", db: this.deps.settingsRepository.getDatabase() },
    ];

    for (const target of targets) {
      try {
        this.deps.logger.info(`Executing VACUUM on ${target.label}...`);
        target.db.exec("VACUUM;");
      } catch (error) {
        failures.push(target.label);
        this.deps.logger.error(`Failed to execute VACUUM on ${target.label}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return failures;
  }
}
