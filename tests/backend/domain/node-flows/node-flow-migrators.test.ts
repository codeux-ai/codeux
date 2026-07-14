import { describe, expect, it } from "vitest";
import { migrateNodeCanvasGraphV1, migrateNodeFlowGraph } from "../../../../src/domain/node-flows/node-flow-migrators.js";

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

  it("migrates a browser v1 canvas into the canonical graph without embedding its snapshot", () => {
    const legacy = {
      nodes: [{ id: "trigger-1", kind: "trigger", label: "Trigger", description: "Draft", position: { x: 1, y: 2 }, inputPorts: [], outputPorts: [{ id: "event" }], config: [], metadata: {} }],
      edges: [], selection: { nodeIds: ["trigger-1"], edgeIds: [] },
    };
    const result = migrateNodeCanvasGraphV1(legacy);

    expect(result.legacySnapshot).toEqual(legacy);
    expect(result.graph.schemaVersion).toBe(2);
    expect(result.graph.metadata).toEqual({ canvasSelection: legacy.selection });
    expect(JSON.stringify(result.graph)).not.toContain("legacySnapshot");
  });

  it("preserves malformed v1 entries for field-level validation without throwing", () => {
    const legacy = {
      nodes: [null, { id: "start", type: "input", title: "Start", ports: [null], credentialBindings: [null] }],
      edges: [null],
    };

    const result = migrateNodeFlowGraph(legacy);

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[0]).toBeNull();
    expect(result.graph.nodes[1]?.ports?.[0]).toBeNull();
    expect(result.graph.nodes[1]?.credentialBindings?.[0]).toBeNull();
    expect(result.graph.edges[0]).toBeNull();
  });

  it("clones malformed canonical graphs deterministically without JSON serialization", () => {
    const metadata: Record<string, unknown> = { valid: true, invalid: undefined };
    metadata.circular = metadata;
    const graph = { schemaVersion: 2, nodes: [], edges: [], metadata };

    const result = migrateNodeFlowGraph(graph);

    expect(result.migrated).toBe(false);
    expect(result.graph.metadata).not.toBe(metadata);
    expect((result.graph.metadata as Record<string, unknown>).circular).toBe(result.graph.metadata);
  });
});
