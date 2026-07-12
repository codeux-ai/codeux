import { describe, expect, it } from "vitest";
import { migrateNodeCanvasGraphV1, migrateNodeFlowGraph } from "../../../../src/domain/node-flows/node-flow-migrators.js";
import { validateNodeFlowGraph } from "../../../../src/domain/node-flows/node-flow-validation.js";

describe("node flow migrators", () => {
  it("deterministically migrates backend v1 while retaining an untouched snapshot", () => {
    const legacy = { nodes: [{ id: "start", type: "input", title: "Start" }], edges: [] };
    const first = migrateNodeFlowGraph(legacy);
    const second = migrateNodeFlowGraph(legacy);

    expect(first).toEqual(second);
    expect(first.legacySnapshot).toEqual(legacy);
    expect(first.graph).toMatchObject({
      schemaVersion: 2,
      nodes: [{ definition: { type: "input", version: 1 }, disabled: false, sideEffect: "none" }],
    });
    expect(legacy).toEqual({ nodes: [{ id: "start", type: "input", title: "Start" }], edges: [] });
  });

  it("migrates a browser v1 canvas into a valid canonical graph with reviewable snapshot metadata", () => {
    const legacy = {
      nodes: [
        { id: "trigger-1", kind: "trigger", label: "Trigger", description: "Draft", position: { x: 1, y: 2 }, inputPorts: [], outputPorts: [{ id: "event" }], config: [], metadata: {} },
        { id: "agent-1", kind: "agent", label: "Agent", inputPorts: [{ id: "in" }], outputPorts: [{ id: "agent" }], config: [], metadata: {} },
        { id: "task-1", kind: "task", label: "Task", inputPorts: [{ id: "agent" }], outputPorts: [{ id: "task" }], config: [{ id: "prompt", value: "Do the work" }], metadata: {} },
      ],
      edges: [
        { id: "one", source: { nodeId: "trigger-1", portId: "event" }, target: { nodeId: "agent-1", portId: "in" } },
        { id: "two", source: { nodeId: "agent-1", portId: "agent" }, target: { nodeId: "task-1", portId: "agent" } },
      ],
      selection: { nodeIds: ["trigger-1"], edgeIds: [] },
    };
    const result = migrateNodeCanvasGraphV1(legacy);

    expect(result.legacySnapshot).toEqual(legacy);
    expect(result.graph.schemaVersion).toBe(2);
    expect(result.graph.nodes.map((node) => node.type)).toEqual(["input", "set_fields", "template"]);
    expect(result.graph.edges).toEqual([
      expect.objectContaining({ fromHandle: "output", toHandle: "input" }),
      expect.objectContaining({ fromHandle: "output", toHandle: "input" }),
    ]);
    expect(result.graph.metadata).toEqual({
      canvasSelection: legacy.selection,
      migration: { source: "browser_canvas_v1", legacySnapshot: legacy },
    });
    expect(validateNodeFlowGraph(result.graph)).toMatchObject({ valid: true, errors: [] });
    expect(migrateNodeCanvasGraphV1(result.graph)).toMatchObject({ migrated: false, legacySnapshot: null });
  });

  it("preserves unsafe legacy keys so canonical validation rejects them", () => {
    const result = migrateNodeCanvasGraphV1({
      nodes: [{ id: "task-1", kind: "task", label: "Task", config: [{ id: "prompt", value: "Safe" }, { id: "generatedSource", value: "unsafe" }] }],
      edges: [],
    });

    expect(validateNodeFlowGraph(result.graph).errors).toContainEqual(expect.objectContaining({
      field: "nodes[0].data",
      code: "unsafe_graph_data",
    }));
  });
});
