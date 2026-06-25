import { describe, expect, it, vi } from "vitest";
import { queryProjectStatsSnapshot } from "../../../../src/repositories/execution/project-stats-snapshot-query.js";
import { ProjectStatsQueryDependencies } from "../../../../src/repositories/execution/execution-stats-types.js";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

describe("queryProjectStatsSnapshot - Duration Aggregation Bounding", () => {
  it("bounds memory usage for duration percentiles while keeping aggregates perfectly accurate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-stats-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    adapter.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE sprints (id TEXT PRIMARY KEY, name TEXT, number INTEGER);
      CREATE TABLE sprint_runs (id TEXT PRIMARY KEY, project_id TEXT, sprint_id TEXT, status TEXT, updated_at TEXT, created_at TEXT, last_heartbeat_at TEXT);
      CREATE TABLE provider_invocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        provider TEXT,
        model TEXT,
        duration_ms INTEGER,
        started_at TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        cached_input_tokens INTEGER,
        reasoning_output_tokens INTEGER,
        usage_source TEXT,
        task_id TEXT,
        sprint_run_id TEXT,
        sprint_id TEXT,
        purpose TEXT,
        status TEXT,
        finished_at TEXT,
        tool_call_count INTEGER
      );
      CREATE TABLE task_runs (id TEXT PRIMARY KEY, project_id TEXT, sprint_id TEXT, sprint_run_id TEXT, task_id TEXT, started_at TEXT, finished_at TEXT, created_at TEXT, pr_url TEXT);
      CREATE TABLE task_run_events (id TEXT PRIMARY KEY, task_run_id TEXT, event_type TEXT, payload_json TEXT, created_at TEXT);
      CREATE TABLE pulls (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, status TEXT, is_merged INTEGER, created_at TEXT, opened_at TEXT, merged_at TEXT);
      CREATE TABLE system_events (id TEXT PRIMARY KEY, project_id TEXT, topic TEXT, created_at TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, is_merged INTEGER);
      CREATE TABLE tasks_git_stats (task_id TEXT PRIMARY KEY, project_id TEXT, metrics_json TEXT);
      CREATE TABLE project_attention_items (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, sprint_id TEXT, sprint_run_id TEXT, created_at TEXT, opened_at TEXT, type TEXT, attention_type TEXT);
    `);

    adapter.exec(`INSERT INTO projects (id, name) VALUES ('proj-1', 'Test Project')`);

    // Insert 50,000 synthetic invocations
    // Using a step function so mathematically calculate expectations
    adapter.transaction(() => {
      const stmt = adapter.prepare("INSERT INTO provider_invocations (project_id, provider, model, duration_ms, started_at) VALUES (?, ?, ?, ?, ?)");

      // First 20,000 (oldest): duration 100ms
      for (let i = 0; i < 20000; i++) {
        stmt.run("proj-1", "openai", "gpt-4", 100, `2023-01-01T12:00:${(i % 60).toString().padStart(2, '0')}Z`);
      }

      // Next 20,000 (middle): duration 500ms
      for (let i = 0; i < 20000; i++) {
        stmt.run("proj-1", "openai", "gpt-4", 500, `2023-01-02T12:00:${(i % 60).toString().padStart(2, '0')}Z`);
      }

      // Last 10,000 (newest): duration 1000ms
      for (let i = 0; i < 9999; i++) {
        stmt.run("proj-1", "openai", "gpt-4", 1000, `2023-01-03T12:00:${(i % 60).toString().padStart(2, '0')}Z`);
      }

      // Insert one massive outlier as the final element
      stmt.run("proj-1", "openai", "gpt-4", 100000, `2023-01-04T12:00:00Z`);

      return "done";
    });

    const depsMock: ProjectStatsQueryDependencies = {
      requireProject: vi.fn(),
      getWallTimeTotalsByTaskIdsForRange: vi.fn().mockReturnValue(new Map()),
      getWallTimeTotalsBySprintRunIdsForRange: vi.fn().mockReturnValue(new Map()),
      getTaskMetadata: vi.fn().mockReturnValue(new Map()),
      getSprintMetadata: vi.fn().mockReturnValue(new Map()),
      updateLastActivity: vi.fn(),
    };

    const snapshot = queryProjectStatsSnapshot(adapter as any, "proj-1", "all", depsMock);

    // The query binds to 10,000 samples out of 50,000
    // But aggregates should be perfectly accurate based on the FULL 50,000
    // Total count: 50,000
    // Average: (20000 * 100 + 20000 * 500 + 9999 * 1000 + 100000) / 50000 = (2000000 + 10000000 + 9999000 + 100000) / 50000 = 22099000 / 50000 = 441.98 -> 442
    // Min: 100
    // Max: 100000

    expect(snapshot.duration.sampleCount).toBe(50000);
    expect(snapshot.duration.avgMs).toBe(442);
    expect(snapshot.duration.maxMs).toBe(100000);

    // The most recent 10,000 samples will be 9999 of 1000ms, and 1 of 100000ms.
    // So p50 of the bound set is 1000ms
    // p95 of the bound set is 1000ms
    // In this skewed case, the exact sample median of the *last 10k* differs from the *true median* of the dataset (which is 500ms).
    // This is mathematically expected when bounding for stability, and we just assert that bounding operates smoothly.
    expect(snapshot.duration.p50Ms).toBe(1000);
    expect(snapshot.duration.p95Ms).toBe(1000);

    // Edge case: Under 10k records (no bounding)
    adapter.exec("DELETE FROM provider_invocations");
    adapter.transaction(() => {
      const stmt = adapter.prepare("INSERT INTO provider_invocations (project_id, provider, model, duration_ms, started_at) VALUES (?, ?, ?, ?, ?)");
      for (let i = 0; i < 5000; i++) {
        stmt.run("proj-1", "openai", "gpt-4", 100, `2023-01-01T12:00:${(i % 60).toString().padStart(2, '0')}Z`);
      }
      return "done";
    });

    const smallSnapshot = queryProjectStatsSnapshot(adapter as any, "proj-1", "all", depsMock);
    expect(smallSnapshot.duration.sampleCount).toBe(5000);
    expect(smallSnapshot.duration.avgMs).toBe(100);
    expect(smallSnapshot.duration.p50Ms).toBe(100);

    // Edge case: Empty dataset
    adapter.exec("DELETE FROM provider_invocations");
    const emptySnapshot = queryProjectStatsSnapshot(adapter as any, "proj-1", "all", depsMock);
    expect(emptySnapshot.duration.sampleCount).toBe(0);
    expect(emptySnapshot.duration.avgMs).toBe(0);
    expect(emptySnapshot.duration.maxMs).toBe(0);
    expect(emptySnapshot.duration.p50Ms).toBe(0);
    expect(emptySnapshot.duration.p95Ms).toBe(0);

    adapter.close();
  });
});
