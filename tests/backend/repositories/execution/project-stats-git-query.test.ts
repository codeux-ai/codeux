import { describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { queryProjectGitStats } from "../../../../src/repositories/execution/project-stats-git-query.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

describe("queryProjectGitStats", () => {
  it("aggregates git metrics and PR counts accurately over multiple events, handling distinct PR deduplication", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-git-stats-"));
    // This auto-runs the real migrations to give us an exact schema
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const db = storage.db;

    // Instead of using mock schemas, rely on AppDbStorage which initialized the DB.
    // However, some columns might be required and missing from tests. We should look at actual tables.
    // Insert simple entities directly into the migrated tables

    const projectId = randomUUID();
    db.prepare("INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)").run(projectId, "test-slug", "Test Project", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");

    const sprintId = randomUUID();
    db.prepare("INSERT INTO sprints (id, project_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'slug', ?, ?, ?)").run(sprintId, projectId, "S1", "open", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");

    const sprintRunId = randomUUID();
    db.prepare("INSERT INTO sprint_runs (id, project_id, sprint_id, status, trigger_type, created_at, updated_at, executor_mode) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)").run(sprintRunId, projectId, sprintId, "completed", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z", "autonomous");

    const taskId = randomUUID();
    db.prepare("INSERT INTO tasks (id, project_id, sprint_id, title, is_merged, status, task_key, prompt_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)").run(taskId, projectId, sprintId, "T1", 1, "open", "KEY-1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    const taskId2 = randomUUID();
    db.prepare("INSERT INTO tasks (id, project_id, sprint_id, title, is_merged, status, task_key, prompt_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)").run(taskId2, projectId, sprintId, "T2", 0, "open", "KEY-2", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");

    const taskRunId = randomUUID();

    const taskRunId2 = randomUUID();

    // tr1: has PR
    db.prepare("INSERT INTO task_runs (id, task_id, project_id, sprint_id, sprint_run_id, pr_url, started_at, finished_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')")
      .run(taskRunId, taskId, projectId, sprintId, sprintRunId, "https://github.com/pr/1", "2024-01-01T10:00:00Z", "2024-01-01T10:30:00Z");

    // tr2: has PR
    db.prepare("INSERT INTO task_runs (id, task_id, project_id, sprint_id, sprint_run_id, pr_url, started_at, finished_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')")
      .run(taskRunId2, taskId2, projectId, sprintId, sprintRunId, "https://github.com/pr/2", "2024-01-01T11:00:00Z", "2024-01-01T11:30:00Z");

    // Multiple git events for taskRunId1
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), taskRunId, "git_metrics", JSON.stringify({ insertions: 10, deletions: 5, filesChanged: 2 }), "2024-01-01T10:10:00Z");
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), taskRunId, "jules_git_pushed", JSON.stringify({ insertions: 20, deletions: 0, filesChanged: 1 }), "2024-01-01T10:20:00Z");

    // One event for taskRunId2
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), taskRunId2, "cli_git_pushed", JSON.stringify({ insertions: 5, deletions: 1, filesChanged: 1 }), "2024-01-01T11:15:00Z");

    // Event that should be ignored (wrong type)
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), taskRunId2, "something_else", JSON.stringify({ insertions: 100, deletions: 100, filesChanged: 100 }), "2024-01-01T11:20:00Z");

    const rangeStartIso = "2024-01-01T00:00:00Z";
    const rangeEndIso = "2024-01-02T00:00:00Z";
    const bucketSizeMs = 3600 * 1000; // 1 hour
    const firstBucketStartMs = new Date("2024-01-01T00:00:00Z").getTime();

    const buckets: any[] = [];
    for(let i=0; i<24; i++) {
        const startMs = firstBucketStartMs + i * bucketSizeMs;
        buckets.push({
            bucketStart: new Date(startMs).toISOString(),
            bucketEnd: new Date(startMs + bucketSizeMs).toISOString(),
            label: "Hour " + i
        });
    }

    const result = queryProjectGitStats(db, projectId, rangeStartIso, rangeEndIso, buckets as any, bucketSizeMs, firstBucketStartMs);

    expect(result.totals.insertions).toBe(25); // max(10, 20) + max(5) = 25
    expect(result.totals.deletions).toBe(6); // max(5, 0) + max(1) = 6
    expect(result.totals.filesChanged).toBe(3); // max(2, 1) + max(1) = 3

    // PR counts: both tr1 and tr2 have a PR
    expect(result.totals.prCount).toBe(2);
    // Merged counts: only task1 is merged
    expect(result.totals.mergedCount).toBe(1);

    expect(result.taskUsage.get(taskId)?.insertions).toBe(20);
    expect(result.taskUsage.get(taskId2)?.insertions).toBe(5);

    expect(result.taskUsage.get(taskId)?.prCount).toBe(1);
    expect(result.taskUsage.get(taskId)?.mergedCount).toBe(1);

    expect(result.taskUsage.get(taskId2)?.prCount).toBe(1);
    expect(result.taskUsage.get(taskId2)?.mergedCount).toBe(0);

    // Both use same sprintRunId
    expect(result.sprintUsage.get(sprintRunId)?.insertions).toBe(25);
    expect(result.sprintUsage.get(sprintRunId)?.prCount).toBe(2);
    expect(result.sprintUsage.get(sprintRunId)?.mergedCount).toBe(1);
  });

  it("deduplicates metrics and PR/merged counts across multiple task runs in different time buckets", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-git-stats-cross-"));
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const db = storage.db;

    const projectId = randomUUID();
    db.prepare("INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)").run(projectId, "test-slug2", "Test Project 2", "2024-02-01T00:00:00Z", "2024-02-01T00:00:00Z");

    const sprintId = randomUUID();
    db.prepare("INSERT INTO sprints (id, project_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'slug', ?, ?, ?)").run(sprintId, projectId, "S2", "open", "2024-02-01T00:00:00Z", "2024-02-01T00:00:00Z");

    const taskId = randomUUID();
    // Task is merged
    db.prepare("INSERT INTO tasks (id, project_id, sprint_id, title, is_merged, status, task_key, prompt_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)").run(taskId, projectId, sprintId, "T1", 1, "open", "KEY-1", "2024-02-01T00:00:00Z", "2024-02-01T00:00:00Z");

    const runId1 = randomUUID();
    // First run in bucket 0, has PR
    db.prepare("INSERT INTO task_runs (id, task_id, project_id, sprint_id, pr_url, started_at, finished_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')")
      .run(runId1, taskId, projectId, sprintId, "https://github.com/pr/1", "2024-02-01T10:00:00Z", "2024-02-01T10:30:00Z");
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), runId1, "git_metrics", JSON.stringify({ insertions: 10, deletions: 5, filesChanged: 2 }), "2024-02-01T10:10:00Z");

    const runId2 = randomUUID();
    // Second run in bucket 1, has SAME PR (or even a new one, should count once per task)
    db.prepare("INSERT INTO task_runs (id, task_id, project_id, sprint_id, pr_url, started_at, finished_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')")
      .run(runId2, taskId, projectId, sprintId, "https://github.com/pr/1", "2024-02-01T11:00:00Z", "2024-02-01T11:30:00Z");
    db.prepare("INSERT INTO task_run_events (id, task_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), runId2, "jules_git_pushed", JSON.stringify({ insertions: 15, deletions: 5, filesChanged: 3 }), "2024-02-01T11:15:00Z");

    const rangeStartIso = "2024-02-01T00:00:00Z";
    const rangeEndIso = "2024-02-02T00:00:00Z";
    const bucketSizeMs = 3600 * 1000; // 1 hour
    const firstBucketStartMs = new Date("2024-02-01T00:00:00Z").getTime();

    const buckets = [];
    for(let i=0; i<24; i++) {
        const startMs = firstBucketStartMs + i * bucketSizeMs;
        buckets.push({
            bucketStart: new Date(startMs).toISOString(),
            bucketEnd: new Date(startMs + bucketSizeMs).toISOString(),
            label: "Hour " + i
        });
    }

    const result = queryProjectGitStats(db, projectId, rangeStartIso, rangeEndIso, buckets as any, bucketSizeMs, firstBucketStartMs);

    // Should only take the MAX metrics across both runs for this task (15 ins, 5 del, 3 files)
    expect(result.totals.insertions).toBe(15);
    expect(result.totals.deletions).toBe(5);
    expect(result.totals.filesChanged).toBe(3);

    // PR and merged should be counted exactly once
    expect(result.totals.prCount).toBe(1);
    expect(result.totals.mergedCount).toBe(1);
  });
});
