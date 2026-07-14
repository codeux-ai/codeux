import { describe, expect, it } from "vitest";
import type { NodeCanvasGraph } from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";
import {
  applyNodeCanvasAgentCommand,
  applyNodeCanvasAgentCommands,
  buildNodeCanvasAgentSummary,
  diffNodeCanvasGraphs,
} from "../../../dashboard/src/v2/lib/nodes-agent-surface.js";
import {
  createInitialNodeCanvasGraph,
  serializeNodeCanvasGraph,
} from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";

const issueKeys = (graph: NodeCanvasGraph): string[] => (
  buildNodeCanvasAgentSummary(graph).validationBlockers.map((issue) => `${issue.code}:${issue.entityId}:${issue.field}`)
);

describe("nodes agent surface", () => {
  it("applies command batches through the canvas reducer", () => {
    const base = createInitialNodeCanvasGraph();
    const result = applyNodeCanvasAgentCommands(base, [
      {
        command: "add_node",
        kind: "task",
        label: "Verification Task",
        position: { x: 420, y: 360 },
        metadata: { taskIntent: "test" },
      },
      {
        command: "patch_node",
        nodeId: "task-2",
        label: "Automated Verification",
        config: { title: "Write focused checks", prompt: "Cover command batches." },
      },
      {
        command: "connect_ports",
        source: { nodeId: "agent-1", portId: "agent" },
        target: { nodeId: "task-2", portId: "agent" },
      },
      {
        command: "select_entities",
        nodeIds: ["task-2"],
        edgeIds: ["edge-agent-1-agent-task-2-agent"],
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.graph.nodes.find((node) => node.id === "task-2")).toMatchObject({
      label: "Automated Verification",
      position: { x: 420, y: 360 },
      metadata: { taskIntent: "test" },
    });
    expect(result.graph.nodes.find((node) => node.id === "task-2")?.config.map((field) => [field.id, field.value]))
      .toEqual([
        ["title", "Write focused checks"],
        ["prompt", "Cover command batches."],
      ]);
    expect(result.graph.edges.map((edge) => edge.id)).toContain("edge-agent-1-agent-task-2-agent");
    expect(result.graph.selection).toEqual({
      nodeIds: ["task-2"],
      edgeIds: ["edge-agent-1-agent-task-2-agent"],
    });
  });

  it("returns command-shape issues instead of throwing for malformed payloads", () => {
    const base = createInitialNodeCanvasGraph();
    const result = applyNodeCanvasAgentCommands(base, [
      null,
      { command: "rename_everything" },
      { command: "add_node", kind: "unknown" },
      { command: "replace_graph", serializedGraph: "not-json" },
    ]);

    expect(result.graph).toEqual(base);
    expect(result.issues.map((issue) => `${issue.code}:${issue.entityId}:${issue.field}`)).toEqual([
      "invalid_agent_command:command[0]:command",
      "invalid_agent_command_payload:command[2]:kind",
      "invalid_agent_command_payload:command[3]:serializedGraph",
      "unknown_agent_command:command[1]:command",
    ]);

    expect(applyNodeCanvasAgentCommands(base, { command: "add_node" }).issues).toEqual([
      {
        code: "invalid_agent_command_payload",
        entityId: "commands",
        field: "commands",
        message: "Agent commands must be an array.",
      },
    ]);
  });

  it("propagates graph validation issues after valid commands", () => {
    const result = applyNodeCanvasAgentCommand(createInitialNodeCanvasGraph(), {
      command: "connect_ports",
      source: { nodeId: "trigger-1", portId: "event" },
      target: { nodeId: "task-1", portId: "agent" },
    });

    expect(result.graph.edges.map((edge) => edge.id)).toContain("edge-trigger-1-event-task-1-agent");
    expect(result.issues.map((issue) => `${issue.code}:${issue.entityId}:${issue.field}`)).toEqual([
      "incompatible_port_type:edge-trigger-1-event-task-1-agent:target.portId",
    ]);
  });

  it("replaces graphs from serialized JSON and reports resulting blockers", () => {
    const invalidGraph = {
      ...createInitialNodeCanvasGraph(),
      nodes: createInitialNodeCanvasGraph().nodes.map((node) => node.id === "task-1" ? { ...node, label: "" } : node),
    };

    const result = applyNodeCanvasAgentCommand(createInitialNodeCanvasGraph(), {
      command: "replace_graph",
      serializedGraph: serializeNodeCanvasGraph(invalidGraph),
    });

    expect(result.graph.nodes.find((node) => node.id === "task-1")?.label).toBe("");
    expect(result.issues.map((issue) => `${issue.code}:${issue.entityId}:${issue.field}`)).toEqual([
      "empty_required_label:task-1:label",
    ]);
  });

  it("builds concise deterministic summaries", () => {
    const result = applyNodeCanvasAgentCommands(createInitialNodeCanvasGraph(), [
      { command: "patch_node", nodeId: "task-1", label: "" },
      { command: "select_entities", nodeIds: ["task-1", "agent-1"], edgeIds: ["edge-agent-1-agent-task-1-agent"] },
    ]);
    const summary = buildNodeCanvasAgentSummary(result.graph);

    expect(summary).toMatchObject({
      nodeCount: 5,
      edgeCount: 4,
      selectedNodeIds: ["agent-1", "task-1"],
      selectedEdgeIds: ["edge-agent-1-agent-task-1-agent"],
    });
    expect(summary.nodes.map((node) => node.id)).toEqual([
      "agent-1",
      "condition-1",
      "output-1",
      "task-1",
      "trigger-1",
    ]);
    expect(summary.edges.map((edge) => `${edge.id}:${edge.source}->${edge.target}`)).toEqual([
      "edge-agent-1-agent-task-1-agent:agent-1.agent->task-1.agent",
      "edge-condition-1-pass-output-1-result:condition-1.pass->output-1.result",
      "edge-task-1-task-condition-1-task:task-1.task->condition-1.task",
      "edge-trigger-1-event-agent-1-in:trigger-1.event->agent-1.in",
    ]);
    expect(issueKeys(result.graph)).toEqual(["empty_required_label:task-1:label"]);
  });

  it("diffs nodes, edges, selection, and validation blockers deterministically", () => {
    const before = createInitialNodeCanvasGraph();
    const after = applyNodeCanvasAgentCommands(before, [
      { command: "patch_node", nodeId: "task-1", label: "" },
      { command: "delete_entities", edgeIds: ["edge-condition-1-pass-output-1-result"] },
      { command: "add_node", kind: "output", label: "Second Output" },
      { command: "select_entities", nodeIds: ["output-2"] },
    ]).graph;

    expect(diffNodeCanvasGraphs(before, after)).toEqual({
      nodes: {
        added: ["output-2"],
        removed: [],
        changed: ["task-1"],
      },
      edges: {
        added: [],
        removed: ["edge-condition-1-pass-output-1-result"],
        changed: [],
      },
      selectionChanged: true,
      validationBlockers: {
        before: [],
        after: ["empty_required_label:task-1:label"],
        added: ["empty_required_label:task-1:label"],
        removed: [],
      },
      changedEntities: [
        "edge:edge-condition-1-pass-output-1-result",
        "node:output-2",
        "node:task-1",
        "selection",
      ],
    });
  });

  it("localizes German command explanations without changing command or validation identities", () => {
    const result = applyNodeCanvasAgentCommands(createInitialNodeCanvasGraph(), [
      { command: "rename_everything" },
      { command: "add_node", kind: "unknown" },
    ], "de");

    expect(result.issues.map(({ code, entityId, field }) => ({ code, entityId, field }))).toEqual([
      { code: "invalid_agent_command_payload", entityId: "command[1]", field: "kind" },
      { code: "unknown_agent_command", entityId: "command[0]", field: "command" },
    ]);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "Der Befehl zum Hinzufügen einer Node benötigt eine gültige Node-Art.",
      "Unbekannter Agentenbefehl \"rename_everything\".",
    ]);
    expect(result.graph).toEqual(createInitialNodeCanvasGraph());
  });
});
