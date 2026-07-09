import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryHeaderTokenThroughputSnapshot } from "../../../../src/repositories/execution/header-token-throughput-query.js";
import { ValidationError } from "../../../../src/repositories/repository-utils.js";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";

describe("header-token-throughput-query", () => {
  let db: SqliteDatabaseAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:17:33.000Z"));
    db = new SqliteDatabaseAdapter(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE provider_invocations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        duration_ms INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("project-a", "Project A");
    db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("project-b", "Project B");
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("aggregates app totals and selected project totals for the requested window", () => {
    insertInvocation({
      id: "a-1",
      projectId: "project-a",
      startedAt: "2026-01-02T11:25:00.000Z",
      durationMs: 60_000,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 50,
      reasoningTokens: 5,
      totalTokens: 170,
    });
    insertInvocation({
      id: "a-2",
      projectId: "project-a",
      startedAt: "2026-01-02T12:10:00.000Z",
      durationMs: 30_000,
      inputTokens: 30,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningTokens: 10,
      totalTokens: 50,
    });
    insertInvocation({
      id: "b-1",
      projectId: "project-b",
      startedAt: "2026-01-02T12:12:00.000Z",
      durationMs: 120_000,
      inputTokens: 200,
      cachedInputTokens: 100,
      outputTokens: 100,
      reasoningTokens: 0,
      totalTokens: 400,
    });
    insertInvocation({
      id: "old-a",
      projectId: "project-a",
      startedAt: "2026-01-02T10:00:00.000Z",
      durationMs: 60_000,
      inputTokens: 999,
      cachedInputTokens: 999,
      outputTokens: 999,
      reasoningTokens: 999,
      totalTokens: 999,
    });

    const snapshot = queryHeaderTokenThroughputSnapshot(db, { window: "1h", projectId: "project-a" });

    expect(snapshot.generatedAt).toBe("2026-01-02T12:17:33.000Z");
    expect(snapshot.window).toBe("1h");
    expect(snapshot.range).toMatchObject({
      window: "1h",
      from: "2026-01-02T11:20:00.000Z",
      to: "2026-01-02T12:20:00.000Z",
      bucketCount: 12,
      isCustom: false,
    });
    expect(snapshot.app).toEqual({
      totalTokens: 620,
      inputTokens: 330,
      cachedInputTokens: 120,
      outputTokens: 170,
      reasoningTokens: 15,
      invocationCount: 3,
      activeTimeMs: 210_000,
      tokensPerMinute: 177.14,
    });
    expect(snapshot.project).toEqual({
      projectId: "project-a",
      projectName: "Project A",
      totalTokens: 220,
      inputTokens: 130,
      cachedInputTokens: 20,
      outputTokens: 70,
      reasoningTokens: 15,
      invocationCount: 2,
      activeTimeMs: 90_000,
      tokensPerMinute: 146.67,
    });
  });

  it("returns app totals with a null project when projectId is omitted", () => {
    insertInvocation({
      id: "b-1",
      projectId: "project-b",
      startedAt: "2026-01-02T12:12:00.000Z",
      durationMs: 120_000,
      inputTokens: 200,
      cachedInputTokens: 100,
      outputTokens: 100,
      reasoningTokens: 0,
      totalTokens: 400,
    });

    const snapshot = queryHeaderTokenThroughputSnapshot(db, { window: "1h" });

    expect(snapshot.app.totalTokens).toBe(400);
    expect(snapshot.project).toBeNull();
  });

  it("calculates the live 20-second header rate from recently updated invocation active time", () => {
    insertInvocation({
      id: "recent-a",
      projectId: "project-a",
      startedAt: "2026-01-02T12:10:20.000Z",
      updatedAt: "2026-01-02T12:17:20.000Z",
      durationMs: 60_000,
      inputTokens: 200,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
      totalTokens: 300,
    });
    insertInvocation({
      id: "recent-b",
      projectId: "project-b",
      startedAt: "2026-01-02T12:05:31.000Z",
      updatedAt: "2026-01-02T12:17:31.000Z",
      durationMs: 60_000,
      inputTokens: 200,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
      totalTokens: 300,
    });
    insertInvocation({
      id: "outside",
      projectId: "project-a",
      startedAt: "2026-01-02T12:17:31.000Z",
      updatedAt: "2026-01-02T12:17:14.999Z",
      durationMs: 1_000,
      inputTokens: 999,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 999,
    });

    const snapshot = queryHeaderTokenThroughputSnapshot(db, { window: "20s" });

    expect(snapshot.window).toBe("20s");
    expect(snapshot.range).toMatchObject({
      window: "20s",
      label: "Last 20 seconds",
      resolution: "5sec",
      resolutionLabel: "5-second telemetry buckets",
      from: "2026-01-02T12:17:15.000Z",
      to: "2026-01-02T12:17:35.000Z",
      bucketCount: 4,
      isCustom: false,
    });
    expect(snapshot.app).toMatchObject({
      totalTokens: 600,
      invocationCount: 2,
      activeTimeMs: 120_000,
      tokensPerMinute: 300,
    });
  });

  it("does not multiply cumulative long-running usage by the 20-second window", () => {
    insertInvocation({
      id: "long-running",
      projectId: "project-a",
      startedAt: "2026-01-02T11:57:31.000Z",
      updatedAt: "2026-01-02T12:17:31.000Z",
      durationMs: 1_200_000,
      inputTokens: 1_500_000,
      cachedInputTokens: 0,
      outputTokens: 500_000,
      reasoningTokens: 0,
      totalTokens: 2_000_000,
    });

    const snapshot = queryHeaderTokenThroughputSnapshot(db, { window: "20s" });

    expect(snapshot.app).toMatchObject({
      totalTokens: 2_000_000,
      invocationCount: 1,
      activeTimeMs: 1_200_000,
      tokensPerMinute: 100_000,
    });
  });

  it("returns numeric zeroes for empty aggregates", () => {
    const snapshot = queryHeaderTokenThroughputSnapshot(db, { window: "24h", projectId: "project-a" });

    expect(snapshot.app).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      invocationCount: 0,
      activeTimeMs: 0,
      tokensPerMinute: 0,
    });
    expect(snapshot.project).toMatchObject({
      projectId: "project-a",
      projectName: "Project A",
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      invocationCount: 0,
      activeTimeMs: 0,
      tokensPerMinute: 0,
    });
  });

  it("throws validation errors for unknown or invalid project ids", () => {
    expect(() => queryHeaderTokenThroughputSnapshot(db, { window: "24h", projectId: "missing" }))
      .toThrow(ValidationError);
    expect(() => queryHeaderTokenThroughputSnapshot(db, { window: "24h", projectId: " " }))
      .toThrow(ValidationError);
  });

  it("supports all required preset windows", () => {
    for (const window of ["20s", "1h", "24h", "7d", "30d", "all"] as const) {
      expect(queryHeaderTokenThroughputSnapshot(db, { window }).window).toBe(window);
    }
  });

  function insertInvocation(input: {
    id: string;
    projectId: string;
    startedAt: string;
    updatedAt?: string;
    durationMs: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  }): void {
    db.prepare(`
      INSERT INTO provider_invocations (
        id,
        project_id,
        started_at,
        updated_at,
        duration_ms,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.projectId,
      input.startedAt,
      input.updatedAt ?? input.startedAt,
      input.durationMs,
      input.inputTokens,
      input.cachedInputTokens,
      input.outputTokens,
      input.reasoningTokens,
      input.totalTokens,
    );
  }
});
