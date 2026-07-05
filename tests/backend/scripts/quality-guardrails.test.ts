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
