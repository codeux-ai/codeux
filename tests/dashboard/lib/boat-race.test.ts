import { describe, expect, it } from "vitest";
import { getBoatRaceHeightPx, getBoatRaceTaskKey, buildBoatRaceDispatchIndex, getShipType } from "../../../dashboard/src/v2/lib/boat-race.js";
import type { ExecutionTaskDispatchSummary } from "../../../dashboard/src/types.js";

describe("boat race task identity", () => {
  it("prefers the persisted task record id so repeated task keys do not reuse old boat state", () => {
    expect(
      getBoatRaceTaskKey({
        id: "T01",
        record_id: "task-record-1",
        project_id: "project-1",
        sprint_id: "sprint-1",
      }),
    ).toBe("task-record-1");
  });

  it("falls back to project and sprint scope when no record id is available", () => {
    expect(
      getBoatRaceTaskKey({
        id: "T01",
        project_id: "project-1",
        sprint_id: "sprint-101",
      }),
    ).toBe("project-1:sprint-101:T01");
  });

  it("uses a fixed 800px race height regardless of fleet size", () => {
    expect(getBoatRaceHeightPx(0)).toBe(800);
    expect(getBoatRaceHeightPx(10)).toBe(800);
    expect(getBoatRaceHeightPx(11)).toBe(800);
    expect(getBoatRaceHeightPx(25)).toBe(800);
  });
});

describe("boat race dispatch index and ship type resolution", () => {
  it("builds a dispatch index keyed by taskId and taskKey", () => {
    const dispatches: ExecutionTaskDispatchSummary[] = [
      {
        id: "dispatch-1",
        taskId: "task-record-1",
        taskKey: "T01",
        executorType: "docker_cli",
        executorId: "executor-1",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
      {
        id: "dispatch-2",
        taskId: "task-record-2",
        taskKey: "T02",
        executorType: "mcp_worker",
        executorId: "executor-2",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ];

    const index = buildBoatRaceDispatchIndex(dispatches);

    expect(index.get("task-record-1")).toBe(dispatches[0]);
    expect(index.get("T01")).toBe(dispatches[0]);
    expect(index.get("task-record-2")).toBe(dispatches[1]);
    expect(index.get("T02")).toBe(dispatches[1]);
    expect(index.get("task-record-3")).toBeUndefined();
  });

  it("resolves to 'container' for docker_cli executor", () => {
    const dispatches: ExecutionTaskDispatchSummary[] = [
      {
        id: "dispatch-1",
        taskId: "task-record-1",
        taskKey: "T01",
        executorType: "docker_cli",
        executorId: "executor-1",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ];
    const index = buildBoatRaceDispatchIndex(dispatches);
    expect(getShipType({ id: "T01", record_id: "task-record-1" }, index)).toBe("container");
  });

  it("resolves to 'wooden' for mcp_worker executor", () => {
    const dispatches: ExecutionTaskDispatchSummary[] = [
      {
        id: "dispatch-1",
        taskId: "task-record-1",
        taskKey: "T01",
        executorType: "mcp_worker",
        executorId: "executor-1",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ];
    const index = buildBoatRaceDispatchIndex(dispatches);
    expect(getShipType({ id: "T01", record_id: "task-record-1" }, index)).toBe("wooden");
  });

  it("falls back to 'wooden' if provider is jules when no match is found", () => {
    const index = new Map<string, ExecutionTaskDispatchSummary>();
    expect(getShipType({ id: "T01", record_id: "task-record-1", provider: "jules" }, index)).toBe("wooden");
  });

  it("falls back to 'container' if provider is unknown and no match is found", () => {
    const index = new Map<string, ExecutionTaskDispatchSummary>();
    expect(getShipType({ id: "T01", record_id: "task-record-1" }, index)).toBe("container");
    expect(getShipType({ id: "T01", record_id: "task-record-1", provider: "unknown_provider" as any }, index)).toBe("container");
  });

  it("resolves using taskKey (id) if taskId (record_id) is missing or not matched", () => {
    const dispatches: ExecutionTaskDispatchSummary[] = [
      {
        id: "dispatch-1",
        taskId: "some-other-task-id",
        taskKey: "T01",
        executorType: "mcp_worker",
        executorId: "executor-1",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ];
    const index = buildBoatRaceDispatchIndex(dispatches);
    expect(getShipType({ id: "T01" }, index)).toBe("wooden");
  });

  it("resolves using taskId (record_id) if taskKey is missing or not matched", () => {
    const dispatches: ExecutionTaskDispatchSummary[] = [
      {
        id: "dispatch-1",
        taskId: "task-record-1",
        taskKey: "some-other-task-key",
        executorType: "mcp_worker",
        executorId: "executor-1",
        status: "RUNNING",
        startedAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      },
    ];
    const index = buildBoatRaceDispatchIndex(dispatches);
    expect(getShipType({ id: "T01", record_id: "task-record-1" }, index)).toBe("wooden");
  });
});
