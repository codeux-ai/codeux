import { describe, expect, it } from "vitest";
import { normalizeNodeFlowGraph, validateNodeFlowGraph } from "../../../../src/domain/node-flows/node-flow-validation.js";
import type { NodeFlowGraph } from "../../../../src/contracts/node-flow-types.js";
import { resolveNodeDefinition } from "../../../../src/domain/node-flows/node-definition-registry.js";

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

  it("fails closed on malformed canonical nested values with stable field paths", () => {
    const graph = {
      schemaVersion: 2,
      nodes: [
        null,
        {
          id: "start",
          type: "input",
          title: "Start",
          definition: { type: "input", version: 1 },
          ports: [null, { id: "out", direction: "output", schema: { type: "any" } }],
          credentialBindings: [null],
          capabilities: [null],
          policy: { retry: null },
        },
      ],
      edges: [null, { fromNodeId: "start", toNodeId: "missing", fromHandle: "out" }],
      schemas: {
        input: { type: "object", properties: { valid: { type: "string" }, invalid: null } },
        output: null,
      },
      metadata: { valid: true, nested: { invalid: undefined } },
    };

    const first = validateNodeFlowGraph(graph);
    const second = validateNodeFlowGraph(graph);

    expect(first).toEqual(second);
    expect(first.valid).toBe(false);
    expect(first.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nodes[0]", code: "invalid_node" }),
      expect.objectContaining({ field: "nodes[1].ports[0]", code: "invalid_port" }),
      expect.objectContaining({ field: "nodes[1].credentialBindings[0]", code: "invalid_credential_binding" }),
      expect.objectContaining({ field: "nodes[1].capabilities[0]", code: "invalid_capability" }),
      expect.objectContaining({ field: "nodes[1].policy.retry", code: "invalid_retry_policy" }),
      expect.objectContaining({ field: "edges[0]", code: "invalid_edge" }),
      expect.objectContaining({ field: "edges[1].toNodeId", code: "invalid_edge_endpoint" }),
      expect.objectContaining({ field: "schemas.input.properties.invalid", code: "invalid_value_schema" }),
      expect.objectContaining({ field: "schemas.output", code: "invalid_value_schema" }),
      expect.objectContaining({ field: "metadata.nested.invalid", code: "invalid_json_value" }),
    ]));
  });

  it("reports malformed Graph v1 references and collections without throwing", () => {
    const graph = {
      nodes: [
        null,
        {
          id: "start",
          type: "input",
          title: "Start",
          definition: { type: "input", version: "invalid" },
          ports: null,
          credentialBindings: null,
          capabilities: null,
          policy: null,
        },
      ],
      edges: [null],
    };

    const result = validateNodeFlowGraph(graph);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nodes[0]", code: "invalid_node" }),
      expect.objectContaining({ field: "nodes[1].definition.version", code: "invalid_definition_version" }),
      expect.objectContaining({ field: "nodes[1].ports", code: "invalid_ports" }),
      expect.objectContaining({ field: "nodes[1].credentialBindings", code: "invalid_credential_bindings" }),
      expect.objectContaining({ field: "nodes[1].capabilities", code: "invalid_capabilities" }),
      expect.objectContaining({ field: "nodes[1].policy", code: "invalid_policy" }),
      expect.objectContaining({ field: "edges[0]", code: "invalid_edge" }),
    ]));
  });

  it("validates credential bindings against the declared slot policy", () => {
    const graph: NodeFlowGraph = {
      nodes: [{
        id: "request",
        type: "http_request",
        title: "Request",
        data: { url: "https://example.test" },
        credentialBindings: [{ slot: "undeclared", credentialId: "credential-1" }],
      }],
      edges: [],
    };

    expect(validateNodeFlowGraph(graph).errors).toContainEqual(expect.objectContaining({
      field: "nodes[0].credentialBindings[0].slot",
      code: "unknown_credential_slot",
    }));
  });

  it("fails closed when a resolved definition exposes an unbounded credential policy", () => {
    const definition = resolveNodeDefinition("http_request", 1)!;
    const original = definition.credentials[0]!.requiredCapabilities;
    definition.credentials[0]!.requiredCapabilities = [];
    try {
      expect(validateNodeFlowGraph({
        nodes: [{ id: "request", type: "http_request", title: "Request", data: { url: "https://example.test" } }],
        edges: [],
      }).errors).toContainEqual(expect.objectContaining({
        field: "nodes[0].definition",
        code: "invalid_credential_policy",
      }));
    } finally {
      definition.credentials[0]!.requiredCapabilities = original;
    }
  });

  it.each([
    [{ schemaVersion: 2, nodes: null, edges: [] }, "nodes"],
    [{ nodes: [], edges: "invalid" }, "edges"],
  ])("rejects malformed graph arrays at their root path", (graph, field) => {
    expect(validateNodeFlowGraph(graph).errors).toContainEqual(expect.objectContaining({ field, code: "required" }));
  });

  it("rejects circular metadata at the repeated field path without throwing", () => {
    const graph = validGraph() as unknown as Record<string, unknown>;
    const metadata: Record<string, unknown> = { safe: true };
    metadata.circular = metadata;
    graph.schemaVersion = 2;
    graph.metadata = metadata;

    const first = validateNodeFlowGraph(graph);
    const second = validateNodeFlowGraph(graph);

    expect(first).toEqual(second);
    expect(first.errors).toContainEqual(expect.objectContaining({
      field: "metadata.circular",
      code: "invalid_json_value",
    }));
  });
});
