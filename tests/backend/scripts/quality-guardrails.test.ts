import { describe, expect, it } from "vitest";

type DuplicateBlock = {
  path: string;
  line: number;
  pattern: string;
  lineCount: number;
  tokenCount: number;
  match: string;
  remediation: string;
};

type GuardrailModule = {
  findDuplicateImplementationBlocks: (
    sources: Array<{ path: string; text: string }>,
    options: { minimumLines: number; minimumTokens: number },
  ) => DuplicateBlock[];
  findRealtimePayloadFingerprintViolations: (
    sources: Array<{ path: string; text: string }>,
  ) => Array<{ path: string; line: number; pattern: string; match: string; remediation: string }>;
  findRealtimeSnapshotPersistenceViolations: (
    repositorySource: { path: string; text: string },
    serviceSource: { path: string; text: string },
  ) => Array<{ path: string; line: number; pattern: string; match: string; remediation: string }>;
  findUnboundedExecutionRuntimeEventQueryViolations: (
    sources: Array<{ path: string; text: string }>,
  ) => Array<{ path: string; line: number; pattern: string; match: string; remediation: string }>;
  findCoverageThresholdViolations: (
    source: string,
    options?: {
      path?: string;
      minimumGlobalThresholds?: Record<string, number>;
      filePath?: string;
      minimumFileLineThreshold?: number;
    },
  ) => Array<{ path: string; line: number; pattern: string; match: string; remediation: string }>;
};

const guardrails = await import("../../../scripts/check-quality-guardrails.mjs") as GuardrailModule;

describe("quality guardrail duplicate scanner", () => {
  it("reports substantial duplicate implementation blocks after normalization", () => {
    const first = `
export function buildFirstReport(input: string[]) {
  const rows = input.map((value) => value.trim());
  const filtered = rows.filter((value) => value.length > 0);
  const counts = new Map<string, number>();
  for (const value of filtered) {
    const previous = counts.get(value) ?? 0;
    counts.set(value, previous + 1);
  }
  const result = [];
  for (const [name, count] of counts.entries()) {
    result.push({ name, count, label: name.toUpperCase() });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}
`;
    const second = `
export function buildSecondReport(input: string[]) {
  const rows = input.map((value) => value.trim());

  const filtered = rows.filter((value) => value.length > 0);
  const counts = new Map<string, number>();
  for (const value of filtered) {
    const previous = counts.get(value) ?? 0;
    counts.set(value, previous + 1);
  }
  const result = [];
  for (const [name, count] of counts.entries()) {
    result.push({ name, count, label: name.toUpperCase() });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}
`;

    const duplicates = guardrails.findDuplicateImplementationBlocks(
      [
        { path: "src/first.ts", text: first },
        { path: "src/second.ts", text: second },
      ],
      { minimumLines: 9, minimumTokens: 60 },
    );

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      path: "src/second.ts",
      pattern: "duplicate implementation block",
    });
    expect(duplicates[0].lineCount).toBeGreaterThanOrEqual(9);
    expect(duplicates[0].match).toContain("duplicated from src/first.ts");
    expect(duplicates[0].remediation).toContain("Extract the shared implementation");
  });

  it("ignores small common patterns, imports, type declarations, and JSX class fragments", () => {
    const duplicates = guardrails.findDuplicateImplementationBlocks(
      [
        {
          path: "dashboard/src/First.tsx",
          text: `
import { h } from "preact";
type ViewState = {
  id: string;
  label: string;
};
export function First() {
  return <button className="inline-flex rounded-md px-2 py-1 text-sm font-medium">Open</button>;
}
`,
        },
        {
          path: "dashboard/src/Second.tsx",
          text: `
import { h } from "preact";
type ViewState = {
  id: string;
  label: string;
};
export function Second() {
  return <button className="inline-flex rounded-md px-2 py-1 text-sm font-medium">Close</button>;
}
`,
        },
      ],
      { minimumLines: 3, minimumTokens: 8 },
    );

    expect(duplicates).toEqual([]);
  });
});

describe("quality guardrail realtime snapshot scanners", () => {
  it("reports direct full-payload JSON fingerprinting in realtime hot-path files", () => {
    const violations = guardrails.findRealtimePayloadFingerprintViolations([
      {
        path: "src/services/dashboard-realtime-service.ts",
        text: `
async function publish(payload: unknown) {
  const fingerprint = JSON.stringify(payload);
  return Buffer.byteLength(fingerprint, "utf8");
}
`,
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: "src/services/dashboard-realtime-service.ts",
      line: 3,
      pattern: "direct realtime payload JSON.stringify",
      match: "JSON.stringify(payload)",
    });
    expect(violations[0].remediation).toContain("getDashboardRealtimePayloadFingerprint");
  });

  it("allows the shared realtime fingerprint helper in snapshot hot paths", () => {
    const violations = guardrails.findRealtimePayloadFingerprintViolations([
      {
        path: "src/services/dashboard-realtime-service.ts",
        text: `
async function publish(eventType: string, payload: unknown) {
  const fingerprint = getDashboardRealtimePayloadFingerprint(eventType, payload);
  return Buffer.byteLength(fingerprint, "utf8");
}
`,
      },
    ]);

    expect(violations).toEqual([]);
  });

  it("keeps replayable domain events allowed while blocking replayable heavy snapshots", () => {
    const repositorySource = {
      path: "src/repositories/dashboard-realtime-event-repository.ts",
      text: `
export function appendEvent(input) {
  if (replayable) {
    INSERT INTO dashboard_realtime_events
  }
}
`,
    };
    const serviceSource = {
      path: "src/services/dashboard-realtime-service.ts",
      text: `
class DashboardRealtimeService {
  private buildPublishTask() {
    return this.publishRawEvent({
      eventType: options.eventType,
      payload,
      replayable: false,
    });
  }

  publishMessage(payload: unknown) {
    return this.publishRawEvent({
      eventType: "conversation.message.created",
      payload,
      replayable: true,
    });
  }

  publishSnapshot(payload: unknown) {
    return this.publishRawEvent({
      eventType: "project.execution.updated",
      payload,
      replayable: true,
    });
  }
}
`,
    };

    const violations = guardrails.findRealtimeSnapshotPersistenceViolations(repositorySource, serviceSource);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: "src/services/dashboard-realtime-service.ts",
      pattern: "project.execution.updated direct publishRawEvent replayability",
    });
    expect(violations[0].match).not.toContain("conversation.message.created");
  });
});

describe("quality guardrail execution runtime-event query scanner", () => {
  it("reports ordered runtime-event reads without an explicit live snapshot bound", () => {
    const violations = guardrails.findUnboundedExecutionRuntimeEventQueryViolations([
      {
        path: "src/repositories/execution/execution-runtime-events-query.ts",
        text: `
export function queryExecutionRuntimeEvents(db) {
  return db.prepare(\`
    SELECT tre.id, tre.created_at
    FROM task_run_events tre
    INNER JOIN task_runs tr ON tr.id = tre.task_run_id
    WHERE tre.project_id = ?
    ORDER BY tre.created_at DESC, tre.id DESC
  \`).all(projectId);
}
`,
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: "src/repositories/execution/execution-runtime-events-query.ts",
      line: 5,
      pattern: "unbounded execution runtime event task_run_events query",
    });
    expect(violations[0].remediation).toContain("SQL LIMIT");
    expect(violations[0].remediation).toContain("run_event_rank");
  });

  it("allows bounded runtime-event LIMIT and per-run rank slices in the scoped projection module", () => {
    const violations = guardrails.findUnboundedExecutionRuntimeEventQueryViolations([
      {
        path: "src/repositories/execution/execution-runtime-events-query.ts",
        text: `
export function queryExecutionRuntimeEvents(db, storage) {
  const recentTaskEvents = db.prepare(\`
    SELECT tre.id, tre.created_at
    FROM task_run_events tre
    WHERE tre.project_id = ?
    ORDER BY tre.created_at DESC, tre.id DESC
    LIMIT ?
  \`).all(projectId, limit);

  const expandedSprintTaskEvents = storage.executeChunkedInQuery({
    sqlPrefix: \`
      SELECT * FROM (
        SELECT
          tre.id,
          tre.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY tr.sprint_run_id
            ORDER BY tre.created_at DESC, tre.id DESC
          ) AS run_event_rank
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        WHERE tre.project_id = ?
          AND tr.sprint_run_id\`,
    sqlSuffix: \`
      ) ranked
      WHERE ranked.run_event_rank <= 120\`,
    items: sprintRunIds,
  });

  const recentSprintRunEvents = db.prepare(\`
    SELECT sre.id, sre.created_at
    FROM sprint_run_events sre
    INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
    WHERE sr.project_id = ?
    ORDER BY sre.created_at DESC, sre.id DESC
    LIMIT ?
  \`).all(projectId, limit);

  return [...recentTaskEvents, ...expandedSprintTaskEvents, ...recentSprintRunEvents];
}
`,
      },
      {
        path: "src/repositories/execution/project-stats-git-query.ts",
        text: `
export function queryAuditHistory(db) {
  return db.prepare(\`
    SELECT tre.id
    FROM task_run_events tre
    ORDER BY tre.created_at DESC
  \`).all();
}
`,
      },
    ]);

    expect(violations).toEqual([]);
  });
});

describe("quality guardrail coverage threshold scanner", () => {
  const passingConfig = `
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        // Never lower these thresholds.
        lines: 77.4,
        functions: 71.5,
        branches: 66.1,
        statements: 76.0,
        "src/server/activity-cache-service.ts": {
          lines: 80,
        },
      },
    },
  },
});
`;

  it("accepts the current global and activity-cache-service coverage thresholds", () => {
    expect(guardrails.findCoverageThresholdViolations(passingConfig)).toEqual([]);
  });

  it("reports lowered global coverage thresholds", () => {
    const violations = guardrails.findCoverageThresholdViolations(
      passingConfig
        .replace("lines: 77.4", "lines: 77.3")
        .replace("functions: 71.5", "functions: 71.4")
        .replace("branches: 66.1", "branches: 66")
        .replace("statements: 76.0", "statements: 75.9"),
    );

    expect(violations.map((violation) => violation.pattern)).toEqual([
      "coverage threshold lines",
      "coverage threshold functions",
      "coverage threshold branches",
      "coverage threshold statements",
    ]);
    expect(violations.map((violation) => violation.match)).toEqual([
      "lines: 77.3",
      "functions: 71.4",
      "branches: 66",
      "statements: 75.9",
    ]);
  });

  it("reports a missing activity-cache-service file threshold", () => {
    const violations = guardrails.findCoverageThresholdViolations(
      passingConfig.replace(`
        "src/server/activity-cache-service.ts": {
          lines: 80,
        },`, ""),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      pattern: "activity-cache-service coverage threshold",
      match: "src/server/activity-cache-service.ts: missing",
    });
  });

  it("reports a lowered activity-cache-service line threshold", () => {
    const violations = guardrails.findCoverageThresholdViolations(
      passingConfig.replace("lines: 80", "lines: 79"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      pattern: "activity-cache-service coverage threshold",
      match: "src/server/activity-cache-service.ts.lines: 79",
    });
  });
});
