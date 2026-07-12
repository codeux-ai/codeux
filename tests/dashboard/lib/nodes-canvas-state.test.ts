import { describe, expect, it } from "vitest";
import type { NodeCanvasGraph } from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";
import {
  createInitialNodeCanvasGraph,
  deserializeNodeCanvasGraph,
  layoutNodeCanvasGraph,
  migrateNodeCanvasGraph,
  nodesCanvasReducer,
  serializeNodeCanvasGraph,
  toCanonicalNodeFlowGraph,
  validateNodeCanvasGraph,
} from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";
import { validateNodeFlowGraph } from "../../../src/domain/node-flows/node-flow-validation.js";

const validationCodes = (graph: NodeCanvasGraph): string[] => (
  validateNodeCanvasGraph(graph).map((issue) => `${issue.code}:${issue.entityId}`)
);

describe("nodes canvas state", () => {
  it("creates a useful deterministic initial graph", () => {
    const graph = createInitialNodeCanvasGraph();

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "agent-1",
      "condition-1",
      "output-1",
      "task-1",
      "trigger-1",
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "edge-agent-1-agent-task-1-agent",
      "edge-condition-1-pass-output-1-result",
      "edge-task-1-task-condition-1-task",
      "edge-trigger-1-event-agent-1-in",
    ]);
    expect(graph.selection).toEqual({ nodeIds: ["trigger-1"], edgeIds: [] });
    expect(validateNodeCanvasGraph(graph)).toEqual([]);
    const canonical = toCanonicalNodeFlowGraph(graph);
    expect(validateNodeFlowGraph(canonical)).toMatchObject({ valid: true, errors: [] });
    expect(canonical.nodes.map((node) => node.type)).toEqual([
      "set_fields",
      "condition",
      "output",
      "template",
      "input",
    ]);
  });

  it("handles reducer node, edge, config, selection, and delete operations", () => {
    let graph = createInitialNodeCanvasGraph();

    graph = nodesCanvasReducer(graph, {
      type: "add_node",
      kind: "task",
      label: "Follow-up Task",
      position: { x: 420, y: 360 },
      metadata: { taskIntent: "test" },
    });

    expect(graph.nodes.find((node) => node.id === "task-2")).toMatchObject({
      label: "Follow-up Task",
      position: { x: 420, y: 360 },
      metadata: { taskIntent: "test" },
    });
    expect(graph.selection).toEqual({ nodeIds: ["task-2"], edgeIds: [] });

    graph = nodesCanvasReducer(graph, {
      type: "update_node_label",
      nodeId: "task-2",
      label: "Verification Task",
    });
    graph = nodesCanvasReducer(graph, {
      type: "update_node_config",
      nodeId: "task-2",
      fieldId: "title",
      value: "Write verification checks",
    });
    graph = nodesCanvasReducer(graph, {
      type: "connect_ports",
      source: { nodeId: "agent-1", portId: "agent" },
      target: { nodeId: "task-2", portId: "agent" },
    });

    expect(graph.nodes.find((node) => node.id === "task-2")?.label).toBe("Verification Task");
    expect(graph.nodes.find((node) => node.id === "task-2")?.config.find((field) => field.id === "title")?.value)
      .toBe("Write verification checks");
    expect(graph.edges.some((edge) => edge.id === "edge-agent-1-agent-task-2-agent")).toBe(true);

    graph = nodesCanvasReducer(graph, {
      type: "select_edge",
      edgeId: "edge-agent-1-agent-task-2-agent",
    });
    expect(graph.selection).toEqual({ nodeIds: [], edgeIds: ["edge-agent-1-agent-task-2-agent"] });

    graph = nodesCanvasReducer(graph, { type: "delete_node", nodeId: "task-2" });
    expect(graph.nodes.some((node) => node.id === "task-2")).toBe(false);
    expect(graph.edges.some((edge) => edge.target.nodeId === "task-2")).toBe(false);
    expect(graph.selection).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it("reports validation issues with stable codes and entity ids", () => {
    const base = createInitialNodeCanvasGraph();
    const trigger = base.nodes.find((node) => node.id === "trigger-1");
    const agent = base.nodes.find((node) => node.id === "agent-1");
    const task = base.nodes.find((node) => node.id === "task-1");
    const condition = base.nodes.find((node) => node.id === "condition-1");
    const output = base.nodes.find((node) => node.id === "output-1");

    if (!trigger || !agent || !task || !condition || !output) {
      throw new Error("Expected seed graph nodes to exist.");
    }

    const invalidGraph = {
      ...base,
      nodes: [
        { ...trigger, label: "", metadata: { agentIntent: "wander" } },
        { ...agent, metadata: { taskIntent: "guess" } },
        task,
        condition,
        output,
        { ...output, id: "duplicate-output" },
        { ...output, id: "duplicate-output" },
      ],
      edges: [
        {
          id: "edge-missing-source",
          source: { nodeId: "missing", portId: "event" },
          target: { nodeId: "agent-1", portId: "in" },
        },
        {
          id: "edge-missing-target",
          source: { nodeId: "trigger-1", portId: "event" },
          target: { nodeId: "missing", portId: "in" },
        },
        {
          id: "edge-self",
          source: { nodeId: "agent-1", portId: "agent" },
          target: { nodeId: "agent-1", portId: "in" },
        },
        {
          id: "edge-missing-port",
          source: { nodeId: "trigger-1", portId: "missing" },
          target: { nodeId: "agent-1", portId: "in" },
        },
        {
          id: "edge-bad-direction",
          source: { nodeId: "agent-1", portId: "in" },
          target: { nodeId: "trigger-1", portId: "event" },
        },
        {
          id: "edge-bad-type",
          source: { nodeId: "trigger-1", portId: "event" },
          target: { nodeId: "task-1", portId: "agent" },
        },
      ],
    } as unknown as NodeCanvasGraph;

    expect(validationCodes(invalidGraph)).toEqual([
      "duplicate_node_id:duplicate-output",
      "empty_required_label:trigger-1",
      "incompatible_port_direction:edge-bad-direction",
      "incompatible_port_type:edge-bad-type",
      "incompatible_port_type:edge-self",
      "invalid_agent_intent:trigger-1",
      "invalid_task_intent:agent-1",
      "missing_edge_source_node:edge-missing-source",
      "missing_edge_source_port:edge-missing-port",
      "missing_edge_target_node:edge-missing-target",
      "self_connection:edge-self",
    ]);
  });

  it("serializes deterministically and recovers malformed persisted input", () => {
    const graph = createInitialNodeCanvasGraph();
    const serialized = serializeNodeCanvasGraph(graph);

    expect(serializeNodeCanvasGraph(deserializeNodeCanvasGraph(serialized))).toBe(serialized);
    expect(deserializeNodeCanvasGraph("not json")).toEqual(graph);

    const recovered = deserializeNodeCanvasGraph(JSON.stringify({
      nodes: [
        {
          id: "agent-9",
          kind: "agent",
          label: "Recovered Agent",
          position: { x: Number.NaN, y: 32 },
          metadata: { agentIntent: "plan", extra: true },
          config: [{ id: "agentPresetId", label: "Agent preset", type: "text", value: { invalid: true } }],
        },
        { id: 42, kind: "task" },
      ],
      edges: [
        { id: "edge-1", source: { nodeId: "agent-9", portId: "agent" }, target: { nodeId: "task-9", portId: "agent" } },
        { id: 7 },
      ],
      selection: { nodeIds: ["agent-9", "missing"], edgeIds: ["edge-1", "missing"] },
    }));

    expect(recovered.nodes).toHaveLength(1);
    expect(recovered.nodes[0]).toMatchObject({
      id: "agent-9",
      label: "Recovered Agent",
      position: { x: 80, y: 32 },
      metadata: { agentIntent: "plan" },
    });
    expect(recovered.nodes[0]?.config.find((field) => field.id === "agentPresetId")?.value).toBeNull();
    expect(recovered.edges).toHaveLength(1);
    expect(recovered.selection).toEqual({ nodeIds: ["agent-9"], edgeIds: ["edge-1"] });
  });

  it("migrates legacy canvas snapshots deterministically without embedding the original", () => {
    const current = createInitialNodeCanvasGraph();
    const { schemaVersion: _schemaVersion, ...legacy } = current;
    const first = migrateNodeCanvasGraph(legacy);
    const second = migrateNodeCanvasGraph(legacy);

    expect(first).toEqual(second);
    expect(first.migrated).toBe(true);
    expect(first.graph.schemaVersion).toBe(2);
    expect(first.legacySnapshot).toEqual(legacy);
    expect(JSON.stringify(first.graph)).not.toContain("legacySnapshot");
    expect(migrateNodeCanvasGraph(first.graph)).toMatchObject({ migrated: false, legacySnapshot: null });
  });

  it("retains a legacy localStorage snapshot as non-executable migration metadata", () => {
    const current = createInitialNodeCanvasGraph();
    const { schemaVersion: _schemaVersion, ...legacyGraph } = current;
    const legacy = JSON.parse(JSON.stringify(legacyGraph)) as typeof legacyGraph;
    const migrated = migrateNodeCanvasGraph(legacy);
    const canonical = toCanonicalNodeFlowGraph(migrated.graph, migrated.legacySnapshot);

    expect(canonical.metadata?.migration).toEqual({
      source: "browser_canvas_v1",
      legacySnapshot: legacy,
    });
    expect(validateNodeFlowGraph(canonical)).toMatchObject({ valid: true, errors: [] });
    expect(toCanonicalNodeFlowGraph(migrated.graph, migrated.legacySnapshot)).toEqual(canonical);
  });

  it("lays out graphs deterministically from ids and edges", () => {
    const graph = {
      ...createInitialNodeCanvasGraph(),
      nodes: [
        createInitialNodeCanvasGraph().nodes.find((node) => node.id === "output-1"),
        createInitialNodeCanvasGraph().nodes.find((node) => node.id === "trigger-1"),
        createInitialNodeCanvasGraph().nodes.find((node) => node.id === "agent-1"),
      ].filter((node): node is NodeCanvasGraph["nodes"][number] => node !== undefined),
      edges: [
        {
          id: "edge-trigger-1-event-agent-1-in",
          source: { nodeId: "trigger-1", portId: "event" },
          target: { nodeId: "agent-1", portId: "in" },
        },
        {
          id: "edge-agent-1-agent-output-1-result",
          source: { nodeId: "agent-1", portId: "agent" },
          target: { nodeId: "output-1", portId: "result" },
        },
      ],
      selection: { nodeIds: [], edgeIds: [] },
    };

    const first = layoutNodeCanvasGraph(graph);
    const second = layoutNodeCanvasGraph({
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    });

    expect(first.nodes.map((node) => [node.id, node.position])).toEqual(second.nodes.map((node) => [node.id, node.position]));
    expect(first.nodes.map((node) => [node.id, node.position])).toEqual([
      ["agent-1", { x: 380, y: 80 }],
      ["output-1", { x: 680, y: 80 }],
      ["trigger-1", { x: 80, y: 80 }],
    ]);
  });
});
