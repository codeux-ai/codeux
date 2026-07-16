import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteDatabaseAdapter } from "../../../src/repositories/db/sqlite-database-adapter.js";
import { DatabaseMaintenanceService } from "../../../src/services/database-maintenance-service.js";

describe("DatabaseMaintenanceService", () => {
  let mockAppDbStorage: any;
  let mockSessionTracking: any;
  let mockSettingsRepository: any;
  let mockLogger: any;
  let mockAppDb: any;
  let mockSessionDb: any;
  let mockSettingsDb: any;

  beforeEach(() => {
    const statement = (changes: number) => ({
      all: vi.fn(() => [{ row_id: 1 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(() => ({ changes })),
    });
    mockAppDb = {
      prepare: vi.fn(() => statement(1)),
      exec: vi.fn(),
    };
    mockSessionDb = {
      prepare: vi.fn(() => statement(2)),
      exec: vi.fn(),
    };
    mockSettingsDb = {
      exec: vi.fn(),
    };

    mockAppDbStorage = { getDatabase: vi.fn(() => mockAppDb) };
    mockSessionTracking = { getDatabase: vi.fn(() => mockSessionDb) };
    mockSettingsRepository = {
      getSystemSettings: vi.fn(() => ({
        runtime: {
          dbAutoVacuumOnStartup: true,
          dbPruningEnabled: true,
          dbRetentionDays: 14,
        },
      })),
      getDatabase: vi.fn(() => mockSettingsDb),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  const createService = () => new DatabaseMaintenanceService({
    appDbStorage: mockAppDbStorage,
    sessionTracking: mockSessionTracking,
    settingsRepository: mockSettingsRepository,
    logger: mockLogger,
  });

  it("skips pruning when disabled", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbPruningEnabled: false, dbAutoVacuumOnStartup: false },
    });

    const result = await createService().runMaintenance();

    expect(result.pruningSkipped).toBe(true);
    expect(result.prunedTaskRuns).toBe(0);
    expect(mockAppDb.prepare).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM"));
  });

  it("uses bounded incremental vacuum instead of a full file rewrite", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbAutoVacuumOnStartup: true, dbPruningEnabled: false },
    });

    const result = await createService().runMaintenance();

    expect(result.vacuumSkipped).toBe(false);
    expect(mockAppDb.exec).toHaveBeenCalledWith("PRAGMA incremental_vacuum(256);");
    expect(mockSessionDb.exec).toHaveBeenCalledWith("PRAGMA incremental_vacuum(256);");
    expect(mockSettingsDb.exec).toHaveBeenCalledWith("PRAGMA incremental_vacuum(256);");
    expect(mockAppDb.exec).not.toHaveBeenCalledWith("VACUUM;");
  });

  it("clamps invalid retention values", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbRetentionDays: -5, dbPruningEnabled: true, dbAutoVacuumOnStartup: false },
    });

    await createService().runMaintenance();

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Starting database maintenance...",
      expect.objectContaining({ retentionDays: 14 }),
    );
  });

  it("records WAL checkpoint busy failures", async () => {
    mockSettingsRepository.getSystemSettings.mockReturnValueOnce({
      runtime: { dbAutoVacuumOnStartup: false, dbPruningEnabled: false },
    });
    mockAppDb.exec.mockImplementation(() => { throw new Error("database is locked"); });

    const result = await createService().runMaintenance();

    expect(result.checkpointFailures).toContain("app.db");
    expect(mockLogger.warn).toHaveBeenCalledWith("WAL checkpoint failed", expect.any(Object));
  });

  it("reports successful bounded pruning counts", async () => {
    const result = await createService().runMaintenance();

    expect(result.pruningSkipped).toBe(false);
    expect(result.prunedTaskRuns).toBe(1);
    expect(result.prunedExecutionInvocations).toBe(1);
    expect(result.prunedProviderInvocations).toBe(1);
    expect(result.prunedAttentionItems).toBe(1);
    expect(result.prunedRealtimeEvents).toBe(1);
    expect(result.prunedVirtualWorkerAssignments).toBe(1);
    expect(result.prunedProviderActivities).toBe(2);
    expect(result.prunedProviderSessions).toBe(2);
    expect(result.recoveredStaleProviderSessions).toBe(2);
    expect(mockAppDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM execution_invocations"));
    expect(mockAppDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM provider_invocations"));
    expect(result.vacuumFailed).toBe(false);
    expect(result.checkpointFailures).toEqual([]);
  });

  it("defers pruning, vacuum, and checkpoints while provider work is active", async () => {
    mockAppDb.prepare.mockImplementation((sql: string) => ({
      all: vi.fn(() => [{ row_id: 1 }]),
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => sql.includes("FROM provider_invocations") ? { active: 1 } : undefined),
    }));

    const result = await createService().runMaintenance();

    expect(result.pruningSkipped).toBe(true);
    expect(result.vacuumSkipped).toBe(true);
    expect(result.checkpointSkipped).toBe(true);
    expect(mockAppDb.exec).not.toHaveBeenCalled();
    expect(mockSessionDb.prepare).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Skipping incremental startup vacuum while provider invocations are active.",
    );
  });

  it("advances all retention categories from the periodic idle sweep", () => {
    const service = createService();

    service.runPeriodicMaintenance();

    expect(mockAppDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM task_runs"));
    expect(mockSessionDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM provider_activities"));
    expect(mockAppDb.exec).toHaveBeenCalledWith("PRAGMA wal_checkpoint(PASSIVE);");
  });

  it("checkpoints WAL files while provider work is active without running retention writes", () => {
    mockAppDb.prepare.mockImplementation((sql: string) => ({
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 0 })),
      get: vi.fn(() => sql.includes("FROM provider_invocations") ? { active: 1 } : undefined),
    }));

    createService().runPeriodicMaintenance();

    expect(mockAppDb.prepare).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM task_runs"));
    expect(mockSessionDb.prepare).not.toHaveBeenCalled();
    expect(mockAppDb.exec).toHaveBeenCalledWith("PRAGMA wal_checkpoint(PASSIVE);");
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "Skipping periodic database pruning while provider invocations are active.",
    );
  });
});

describe("DatabaseMaintenanceService SQLite retention", () => {
  const databases: SqliteDatabaseAdapter[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  const createDatabase = (): SqliteDatabaseAdapter => {
    const database = new SqliteDatabaseAdapter(":memory:");
    databases.push(database);
    return database;
  };

  const createRealService = () => {
    const appDb = createDatabase();
    const sessionDb = createDatabase();
    const settingsDb = createDatabase();
    appDb.exec(`
      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        finished_at TEXT
      );
      CREATE TABLE project_attention_items (
        id TEXT PRIMARY KEY,
        resolved_at TEXT
      );
      CREATE TABLE provider_invocations (
        id TEXT PRIMARY KEY,
        task_run_id TEXT,
        attention_item_id TEXT,
        status TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (attention_item_id) REFERENCES project_attention_items(id) ON DELETE CASCADE
      );
      CREATE TABLE execution_invocations (
        id TEXT PRIMARY KEY,
        task_run_id TEXT,
        provider_invocation_id TEXT,
        attention_item_id TEXT,
        finished_at TEXT,
        preserved_at TEXT,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_invocation_id) REFERENCES provider_invocations(id) ON DELETE SET NULL,
        FOREIGN KEY (attention_item_id) REFERENCES project_attention_items(id) ON DELETE CASCADE
      );
      CREATE TABLE execution_invocation_messages (
        id TEXT PRIMARY KEY,
        invocation_id TEXT NOT NULL,
        FOREIGN KEY (invocation_id) REFERENCES execution_invocations(id) ON DELETE CASCADE
      );
      CREATE TABLE task_run_events (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE task_self_reflection_ratings (
        id TEXT PRIMARY KEY,
        source_task_run_id TEXT NOT NULL,
        FOREIGN KEY (source_task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE qa_review_runs (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE node_flow_runs (
        id TEXT PRIMARY KEY,
        execution_invocation_id TEXT,
        FOREIGN KEY (execution_invocation_id) REFERENCES execution_invocations(id) ON DELETE SET NULL
      );
      CREATE TABLE node_flow_node_runs (
        id TEXT PRIMARY KEY,
        execution_invocation_id TEXT,
        FOREIGN KEY (execution_invocation_id) REFERENCES execution_invocations(id) ON DELETE SET NULL
      );
      CREATE TABLE dashboard_realtime_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE project_worker_assignments (
        id TEXT PRIMARY KEY,
        worker_endpoint_type TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX idx_execution_invocations_task_run
        ON execution_invocations(task_run_id);
      CREATE INDEX idx_execution_invocations_provider_invocation
        ON execution_invocations(provider_invocation_id);
      CREATE INDEX idx_execution_invocation_messages_invocation
        ON execution_invocation_messages(invocation_id);
      CREATE INDEX idx_provider_invocations_task_run
        ON provider_invocations(task_run_id);
      CREATE INDEX idx_task_run_events_task_run
        ON task_run_events(task_run_id);
    `);
    sessionDb.exec(`
      CREATE TABLE provider_sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        state TEXT NOT NULL,
        update_time TEXT NOT NULL
      );
      CREATE TABLE provider_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        create_time TEXT NOT NULL
      );
      CREATE INDEX idx_provider_activities_session_time
        ON provider_activities(session_id, create_time DESC);
    `);
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const service = new DatabaseMaintenanceService({
      appDbStorage: { getDatabase: () => appDb } as any,
      sessionTracking: { getDatabase: () => sessionDb } as any,
      settingsRepository: {
        getSystemSettings: () => ({
          runtime: {
            dbAutoVacuumOnStartup: false,
            dbPruningEnabled: true,
            dbRetentionDays: 14,
          },
        }),
        getDatabase: () => settingsDb,
      } as any,
      logger: logger as any,
    });
    return { appDb, service };
  };

  it("deletes no more than one fixed batch from a large table per sweep", () => {
    const { appDb, service } = createRealService();
    const insert = appDb.prepare("INSERT INTO dashboard_realtime_events (created_at) VALUES (?)");
    appDb.transaction(() => {
      for (let index = 0; index < 501; index += 1) {
        insert.run("2000-01-01T00:00:00.000Z");
      }
    });

    service.runPeriodicMaintenance();

    const row = appDb.prepare("SELECT COUNT(*) AS count FROM dashboard_realtime_events").get() as { count: number };
    expect(row.count).toBe(1);

    service.runPeriodicMaintenance();

    const converged = appDb.prepare("SELECT COUNT(*) AS count FROM dashboard_realtime_events").get() as { count: number };
    expect(converged.count).toBe(0);
  });

  it("preserves marked invocation trees while pruning an eligible foreign-key tree", () => {
    const { appDb, service } = createRealService();
    const old = "2000-01-01T00:00:00.000Z";
    appDb.exec(`
      INSERT INTO task_runs (id, finished_at) VALUES ('kept-run', '${old}'), ('deleted-run', '${old}');
      INSERT INTO project_attention_items (id, resolved_at) VALUES ('kept-attention', '${old}'), ('deleted-attention', '${old}');
      INSERT INTO provider_invocations (id, task_run_id, attention_item_id, status, finished_at)
      VALUES
        ('kept-provider', 'kept-run', 'kept-attention', 'completed', '${old}'),
        ('deleted-provider', 'deleted-run', 'deleted-attention', 'completed', '${old}');
      INSERT INTO execution_invocations (
        id, task_run_id, provider_invocation_id, attention_item_id, finished_at, preserved_at
      ) VALUES
        ('kept-execution', 'kept-run', 'kept-provider', 'kept-attention', '${old}', '${old}'),
        ('deleted-execution', 'deleted-run', 'deleted-provider', 'deleted-attention', '${old}', NULL);
      INSERT INTO execution_invocation_messages (id, invocation_id)
      VALUES ('kept-message', 'kept-execution'), ('deleted-message', 'deleted-execution');
      INSERT INTO task_run_events (id, task_run_id)
      VALUES ('kept-event', 'kept-run'), ('deleted-event', 'deleted-run');
      INSERT INTO task_self_reflection_ratings (id, source_task_run_id)
      VALUES ('kept-rating', 'kept-run'), ('deleted-rating', 'deleted-run');
      INSERT INTO qa_review_runs (id, task_run_id)
      VALUES ('kept-qa', 'kept-run'), ('deleted-qa', 'deleted-run');
      INSERT INTO node_flow_runs (id, execution_invocation_id)
      VALUES ('kept-flow', 'kept-execution'), ('detached-flow', 'deleted-execution');
      INSERT INTO node_flow_node_runs (id, execution_invocation_id)
      VALUES ('kept-node', 'kept-execution'), ('detached-node', 'deleted-execution');
    `);

    service.runPeriodicMaintenance();

    const ids = (table: string): string[] => (appDb.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id);
    expect(ids("task_runs")).toEqual(["kept-run"]);
    expect(ids("provider_invocations")).toEqual(["kept-provider"]);
    expect(ids("execution_invocations")).toEqual(["kept-execution"]);
    expect(ids("execution_invocation_messages")).toEqual(["kept-message"]);
    expect(ids("task_run_events")).toEqual(["kept-event"]);
    expect(ids("task_self_reflection_ratings")).toEqual(["kept-rating"]);
    expect(ids("qa_review_runs")).toEqual(["kept-qa"]);
    expect(ids("project_attention_items")).toEqual(["kept-attention"]);
    const flowLinks = appDb.prepare(`
      SELECT id, execution_invocation_id AS invocationId
      FROM node_flow_runs
      ORDER BY id
    `).all() as Array<{ id: string; invocationId: string | null }>;
    expect(flowLinks).toEqual([
      { id: "detached-flow", invocationId: null },
      { id: "kept-flow", invocationId: "kept-execution" },
    ]);
  });

  it("enables bounded incremental vacuum mode for newly created SQLite databases", () => {
    const database = createDatabase();

    const row = database.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number };

    expect(row.auto_vacuum).toBe(2);
  });

  it("does not rewrite an existing auto_vacuum NONE database during connection startup", () => {
    const directory = mkdtempSync(join(tmpdir(), "code-ux-maintenance-"));
    const databasePath = join(directory, "legacy.db");
    try {
      const legacyDatabase = new DatabaseSync(databasePath);
      legacyDatabase.exec("CREATE TABLE retained_history (id INTEGER PRIMARY KEY, payload TEXT);");
      legacyDatabase.close();

      const database = new SqliteDatabaseAdapter(databasePath);
      databases.push(database);
      const row = database.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number };

      expect(row.auto_vacuum).toBe(0);
    } finally {
      for (const database of databases.splice(0)) {
        database.close();
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
