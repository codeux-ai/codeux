/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { NodeFlowCanvas } from "../../../dashboard/src/v2/components/nodes/NodeFlowCanvas.js";
import type { NodeFlowGraph } from "../../../dashboard/src/v2/types.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

const graph: NodeFlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "input-1", type: "input", title: "Input", position: { x: 40, y: 40 } }],
  edges: [],
};

describe("NodeFlowCanvas", () => {
  it("keeps drag movement local and commits one graph update on pointer release", () => {
    const onMoveNode = vi.fn();
    const { getByRole } = render(
      <DashboardI18nProvider storage={null}><NodeFlowCanvas
        graph={graph}
        selectedNodeId="input-1"
        onSelectNode={() => undefined}
        onMoveNode={onMoveNode}
      /></DashboardI18nProvider>,
    );
    const canvas = getByRole("region", { name: "Node flow canvas" });
    const node = getByRole("button", { name: "Select node Input" });
    Object.defineProperty(node, "setPointerCapture", { value: vi.fn() });
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
      x: 40, y: 40, left: 40, top: 40, right: 260, bottom: 156, width: 220, height: 116, toJSON: () => ({}),
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}),
    });

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 180 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 220 });

    expect(onMoveNode).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 240, clientY: 220 });

    expect(onMoveNode).toHaveBeenCalledTimes(1);
    expect(onMoveNode).toHaveBeenCalledWith("input-1", { x: 220, y: 200 });
  });
});
