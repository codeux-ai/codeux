import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../dashboard/src/types.js";
import { buildSprintDagModel, getSprintDagFocusNodeIds } from "../../../dashboard/src/v2/lib/sprint-dag.js";

function makeTask(overrides: Partial<Subtask> & Pick<Subtask, "id" | "title">): Subtask {
  return {
    id: overrides.id,
    title: overrides.title,
    prompt: overrides.prompt || `Implement ${overrides.title}`,
    depends_on: overrides.depends_on || [],
    is_independent: overrides.is_independent ?? (overrides.depends_on?.length ?? 0) === 0,
    status: overrides.status || "PENDING",
    ...overrides,
  };
}

describe("buildSprintDagModel", () => {
  it("builds topological depths and edge states from runtime tasks", () => {
    const model = buildSprintDagModel([
      makeTask({ id: "T01", title: "Foundation", status: "COMPLETED" }),
      makeTask({ id: "T02", title: "Parallel A", depends_on: ["T01"], status: "RUNNING" }),
      makeTask({ id: "T03", title: "Parallel B", depends_on: ["T01"], status: "PENDING" }),
      makeTask({ id: "T04", title: "Integration", depends_on: ["T02", "T03"], status: "PENDING" }),
    ]);

    expect(model.columns).toHaveLength(3);
    expect(model.columns[0]?.map((node) => node.task.id)).toEqual(["T01"]);
    expect(model.columns[1]?.map((node) => node.task.id)).toEqual(["T02", "T03"]);
    expect(model.columns[2]?.map((node) => node.task.id)).toEqual(["T04"]);
    expect(model.metrics.rootCount).toBe(1);
    expect(model.metrics.longestChain).toBe(3);

    const activeEdge = model.edges.find((edge) => edge.id === "T01->T02");
    const pendingEdge = model.edges.find((edge) => edge.id === "T03->T04");
    expect(activeEdge?.state).toBe("active");
    expect(pendingEdge?.state).toBe("pending");
  });

  it("marks root tasks and dependency-unlocked tasks as ready", () => {
    const model = buildSprintDagModel([
      makeTask({ id: "T01", title: "Root Ready", status: "PENDING" }),
      makeTask({ id: "T02", title: "Complete Base", status: "COMPLETED" }),
      makeTask({ id: "T03", title: "Unlocked Child", depends_on: ["T02"], status: "PENDING" }),
      makeTask({ id: "T04", title: "Blocked Child", depends_on: ["T01"], status: "PENDING" }),
    ]);

    expect(model.metrics.readyCount).toBe(2);
    expect(model.nodes.filter((node) => node.isReady).map((node) => node.task.id)).toEqual(["T01", "T03"]);
  });

  it("treats blocked branches as blocked edges", () => {
    const model = buildSprintDagModel([
      makeTask({ id: "T01", title: "Base", status: "COMPLETED" }),
      makeTask({ id: "T02", title: "Blocked", depends_on: ["T01"], status: "BLOCKED" }),
    ]);

    expect(model.edges[0]?.state).toBe("blocked");
  });

  it("focuses the live viewport on the active frontier", () => {
    const runningModel = buildSprintDagModel([
      makeTask({ id: "T01", title: "Base", status: "COMPLETED" }),
      makeTask({ id: "T02", title: "Running A", depends_on: ["T01"], status: "RUNNING" }),
      makeTask({ id: "T03", title: "Running B", depends_on: ["T01"], status: "RUNNING" }),
      makeTask({ id: "T04", title: "Future", depends_on: ["T02"], status: "PENDING" }),
    ]);
    expect(getSprintDagFocusNodeIds(runningModel)).toEqual(["T02", "T03"]);

    const readyModel = buildSprintDagModel([
      makeTask({ id: "T01", title: "Done", status: "COMPLETED" }),
      makeTask({ id: "T02", title: "Ready Child", depends_on: ["T01"], status: "PENDING" }),
      makeTask({ id: "T03", title: "Blocked Child", depends_on: ["T02"], status: "PENDING" }),
    ]);
    expect(getSprintDagFocusNodeIds(readyModel)).toEqual(["T02"]);
  });
});
