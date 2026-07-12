import { describe, expect, it } from "vitest";
import { normalizeNodeFlowGraph, validateNodeFlowGraph } from "../../../../src/domain/node-flows/node-flow-validation.js";
import type { NodeFlowGraph } from "../../../../src/contracts/node-flow-types.js";

const validGraph = (): NodeFlowGraph => ({
  inputSchema: {
    fields: [
      { id: "prompt", type: "textarea", label: "Prompt", required: true },
      { id: "count", type: "number", label: "Count", defaultValue: 2, min: 1 },
      { id: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { id: "mode", type: "select", label: "Mode", options: [{ label: "Draft", value: "draft" }], defaultValue: "draft" },
      { id: "payload", type: "json", label: "Payload", defaultValue: { ok: true } },
      { id: "secret", type: "secretRef", label: "Secret", defaultValue: "provider-token" },
      { id: "headers", type: "keyValue", label: "Headers", defaultValue: { accept: "application/json" } },
    ],
  },
  nodes: [
    { id: "start", type: "input", title: "Start" },
    { id: "finish", type: "output", title: "Finish" },
  ],
  edges: [
    { fromNodeId: "start", toNodeId: "finish" },
  ],
});

describe("node flow validation", () => {
  it("normalizes valid widget metadata and returns execution order", () => {
    const result = validateNodeFlowGraph(validGraph());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.executionOrder).toEqual(["start", "finish"]);
    expect(result.graph?.inputSchema?.fields.map((field) => field.type)).toEqual([
      "textarea",
      "number",
      "boolean",
      "select",
      "json",
      "secretRef",
      "keyValue",
    ]);
  });

  it("rejects duplicate node ids and invalid edge endpoints", () => {
    const graph = validGraph();
    graph.nodes.push({ id: "start", type: "output", title: "Duplicate" });
    graph.edges.push({ fromNodeId: "missing", toNodeId: "finish" });

    const result = validateNodeFlowGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "duplicate_node_id",
      "invalid_edge_endpoint",
    ]));
  });

  it("rejects cyclic graphs with a descriptive error", () => {
    const graph = validGraph();
    graph.edges.push({ fromNodeId: "finish", toNodeId: "start" });

    expect(() => normalizeNodeFlowGraph(graph)).toThrow(/acyclic|validation failed/i);
    const result = validateNodeFlowGraph(graph);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "cycle_detected" }),
    ]));
  });

  it("rejects unsafe or mismatched widget defaults", () => {
    const graph = validGraph();
    graph.inputSchema!.fields.push(
      { id: "badNumber", type: "number", label: "Bad number", defaultValue: "2" },
      { id: "badSelect", type: "select", label: "Bad select", options: [{ label: "A", value: "a" }], defaultValue: "b" },
    );

    const result = validateNodeFlowGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "invalid_default_type",
      "invalid_select_default",
    ]));
  });

  it("rejects unknown definitions, invalid policies, and unsafe graph values with field paths", () => {
    const graph = validGraph();
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      definition: { type: "planned_only", version: 1 },
      policy: { retry: { maxAttempts: 0, backoffMs: -1 }, timeout: { timeoutMs: 0 } },
      data: { generatedSource: "not allowed" },
    };

    const result = validateNodeFlowGraph(graph);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nodes[0].definition", code: "unknown_node_definition" }),
      expect.objectContaining({ field: "nodes[0].policy.retry.maxAttempts", code: "invalid_retry_policy" }),
      expect.objectContaining({ field: "nodes[0].policy.timeout.timeoutMs", code: "invalid_timeout_policy" }),
      expect.objectContaining({ field: "nodes[0].data", code: "unsafe_graph_data" }),
    ]));
  });

  it("orders independent nodes deterministically by stable id", () => {
    const graph: NodeFlowGraph = {
      nodes: [
        { id: "z", type: "input", title: "Z" },
        { id: "a", type: "input", title: "A" },
      ],
      edges: [],
    };

    expect(validateNodeFlowGraph(graph).executionOrder).toEqual(["a", "z"]);
  });
});
