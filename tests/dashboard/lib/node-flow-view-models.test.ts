import { describe, expect, it } from "vitest";
import type { NodeFlowGraph, NodeFlowRecord, NodeFlowValidationResponse } from "../../../dashboard/src/v2/types.js";
import {
  applyWidgetDefaults,
  buildValidationMessagesByField,
  createDefaultNodeFlowGraph,
  getValidationBadgeState,
  getWidgetFieldDefaultValue,
  isNodeFlowDirty,
  layoutNodeFlowGraph,
  redactNodeFlowSecrets,
  stableStringify,
  updateNodeInGraph,
} from "../../../dashboard/src/v2/lib/node-flow-view-models.js";

const graph: NodeFlowGraph = {
  nodes: [
    { id: "a", type: "manual", title: "A", position: { x: 10, y: 20 } },
    { id: "b", type: "action", title: "B" },
    { id: "c", type: "action", title: "C" },
  ],
  edges: [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
  ],
};

describe("node-flow view models", () => {
  it("creates a valid default graph shape for new flows", () => {
    const defaultGraph = createDefaultNodeFlowGraph();

    expect(defaultGraph.nodes).toHaveLength(1);
    expect(defaultGraph.nodes[0]?.id).toBe("trigger");
    expect(defaultGraph.inputSchema?.fields[0]?.type).toBe("json");
  });

  it("fills missing canvas positions while preserving explicit positions", () => {
    const layout = layoutNodeFlowGraph(graph);

    expect(layout.nodes.find((node) => node.id === "a")?.position).toEqual({ x: 10, y: 20 });
    expect(layout.nodes.find((node) => node.id === "b")?.position.x).toBeGreaterThan(10);
    expect(layout.nodes.find((node) => node.id === "c")?.position.x).toBeGreaterThan(
      layout.nodes.find((node) => node.id === "b")?.position.x ?? 0,
    );
  });

  it("summarizes validation badge states", () => {
    expect(getValidationBadgeState(null, false)).toMatchObject({ tone: "neutral", label: "Unvalidated" });
    expect(getValidationBadgeState(null, true)).toMatchObject({ tone: "warning", label: "Unsaved" });
    expect(getValidationBadgeState({ valid: true, errors: [] }, false)).toMatchObject({ tone: "success", label: "Valid" });
    expect(getValidationBadgeState({ valid: false, errors: [{ field: "nodes", code: "required", message: "Missing" }] }, false))
      .toMatchObject({ tone: "danger", label: "1 issue" });
  });

  it("applies widget defaults by field type without overwriting existing values", () => {
    const values = applyWidgetDefaults({
      fields: [
        { id: "name", type: "text", label: "Name", defaultValue: "Default" },
        { id: "count", type: "number", label: "Count", min: 2 },
        { id: "enabled", type: "boolean", label: "Enabled" },
        { id: "mode", type: "select", label: "Mode", options: [{ label: "Fast", value: "fast" }] },
        { id: "meta", type: "json", label: "Meta" },
        { id: "headers", type: "keyValue", label: "Headers" },
      ],
    }, { name: "Existing" });

    expect(values).toEqual({
      name: "Existing",
      count: 2,
      enabled: false,
      mode: "fast",
      meta: {},
      headers: {},
    });
    expect(getWidgetFieldDefaultValue({ id: "secret", type: "secretRef", label: "Secret" })).toBe("");
  });

  it("detects dirty state using stable graph comparison", () => {
    const record: NodeFlowRecord = {
      id: "flow-1",
      projectId: "project-1",
      title: "Flow",
      description: "Desc",
      graph,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(isNodeFlowDirty(record, "Flow", "Desc", graph)).toBe(false);
    expect(isNodeFlowDirty(record, "Flow 2", "Desc", graph)).toBe(true);
    expect(isNodeFlowDirty(record, "Flow", "Desc", updateNodeInGraph(graph, "b", { title: "Updated" }))).toBe(true);
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("groups validation messages and redacts secret-shaped output keys", () => {
    const validation: NodeFlowValidationResponse = {
      valid: false,
      errors: [
        { field: "nodes[0].title", code: "required", message: "Title required" },
        { field: "nodes[0].title", code: "short", message: "Title short" },
      ],
    };

    expect(buildValidationMessagesByField(validation).get("nodes[0].title")).toEqual(["Title required", "Title short"]);
    expect(redactNodeFlowSecrets({
      apiKey: "real",
      nested: { password: "hidden", ok: true },
      list: [{ token: "secret" }],
    })).toEqual({
      apiKey: "[redacted]",
      nested: { password: "[redacted]", ok: true },
      list: [{ token: "[redacted]" }],
    });
  });
});
