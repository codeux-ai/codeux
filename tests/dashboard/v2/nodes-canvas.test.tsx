/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeCanvas } from "../../../dashboard/src/v2/components/nodes/NodeCanvas.js";
import type { NodeCanvasGraph } from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";
import {
  createInitialNodeCanvasGraph,
  nodesCanvasReducer,
} from "../../../dashboard/src/v2/lib/nodes-canvas-state.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => false,
  useResolvedMotionDuration: <T,>(duration: T): T => duration,
}));

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NodeCanvas", () => {
  it("renders seed graph nodes, selectable cards, handles, edges, toolbar, and minimap", () => {
    render(<NodeCanvas graph={createInitialNodeCanvasGraph()} />);

    expect(screen.getByRole("application", { name: "Node canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project Trigger trigger node/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Agent Router agent node/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Node canvas edges" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select edge trigger-1 to agent-1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in node canvas" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Node canvas minimap" })).toBeInTheDocument();
    expect(screen.getAllByText("Valid")).toHaveLength(5);
    expect(screen.getAllByText("1 handles")).toHaveLength(2);
  });

  it("uses controlled callbacks for node and edge selection", () => {
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();

    render(
      <NodeCanvas
        graph={createInitialNodeCanvasGraph()}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Task Draft task node/i }));
    expect(onSelectNode).toHaveBeenCalledWith("task-1", false);

    fireEvent.click(screen.getByRole("button", { name: /Select edge agent-1 to task-1/i }), { shiftKey: true });
    expect(onSelectEdge).toHaveBeenCalledWith("edge-agent-1-agent-task-1-agent", true);
  });

  it("updates viewport controls without depending on route integration", () => {
    render(<NodeCanvas graph={createInitialNodeCanvasGraph()} />);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in node canvas" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom out node canvas" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fit node canvas view" }));
    expect(screen.queryByText("100%")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset node canvas view" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("supports keyboard focus movement and delete callbacks", () => {
    const onDeleteNode = vi.fn();
    const onSelectNode = vi.fn();
    render(
      <NodeCanvas
        graph={createInitialNodeCanvasGraph()}
        onSelectNode={onSelectNode}
        onDeleteNode={onDeleteNode}
      />,
    );

    const canvas = screen.getByRole("application", { name: "Node canvas" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onSelectNode).toHaveBeenCalledWith("agent-1", false);

    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(onDeleteNode).toHaveBeenCalledWith("trigger-1");
  });

  it("can be wired as a controlled graph and delete selected edges", () => {
    const onDeleteEdge = vi.fn();
    render(<ControlledCanvas onDeleteEdge={onDeleteEdge} />);

    fireEvent.click(screen.getByRole("button", { name: /Select edge trigger-1 to agent-1/i }));
    expect(screen.getByRole("button", { name: /Select edge trigger-1 to agent-1/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(screen.getByRole("application", { name: "Node canvas" }), { key: "Delete" });
    expect(onDeleteEdge).toHaveBeenCalledWith("edge-trigger-1-event-agent-1-in");
    expect(screen.queryByRole("button", { name: /Select edge trigger-1 to agent-1/i })).not.toBeInTheDocument();
  });

  it("keeps long node labels constrained in reduced-width containers", () => {
    const graph = nodesCanvasReducer(createInitialNodeCanvasGraph(), {
      type: "update_node_label",
      nodeId: "trigger-1",
      label: "ManualTriggerWithAnExtremelyLongUnbrokenWorkflowNameThatShouldNotBreakTheCanvas",
    });
    render(
      <div style={{ width: "320px" }}>
        <NodeCanvas graph={graph} />
      </div>,
    );

    const node = screen.getByRole("button", { name: /ManualTriggerWithAnExtremelyLongUnbrokenWorkflowNameThatShouldNotBreakTheCanvas/i });
    expect(node).toHaveStyle({ width: "248px", height: "156px" });
    expect(screen.getByText("ManualTriggerWithAnExtremelyLongUnbrokenWorkflowNameThatShouldNotBreakTheCanvas"))
      .toHaveClass("break-words");
  });

  it("renders loading and empty states", () => {
    const graph = createInitialNodeCanvasGraph();
    const { rerender } = render(<NodeCanvas graph={graph} loading />);

    expect(screen.getByRole("region", { name: "Node canvas loading" })).toBeInTheDocument();
    expect(screen.getByText("Loading node canvas")).toBeInTheDocument();

    rerender(<NodeCanvas graph={{ nodes: [], edges: [], selection: { nodeIds: [], edgeIds: [] } }} />);

    expect(screen.getByRole("region", { name: "Empty node canvas" })).toBeInTheDocument();
    expect(screen.getByText("No nodes on this canvas")).toBeInTheDocument();
  });
});

const ControlledCanvas = ({ onDeleteEdge }: { onDeleteEdge: (edgeId: string) => void }) => {
  const [graph, setGraph] = useState<NodeCanvasGraph>(() => createInitialNodeCanvasGraph());

  return (
    <NodeCanvas
      graph={graph}
      onSelectNode={(nodeId, append) => {
        setGraph((current) => nodesCanvasReducer(current, { type: "select_node", nodeId, append }));
      }}
      onSelectEdge={(edgeId, append) => {
        setGraph((current) => nodesCanvasReducer(current, { type: "select_edge", edgeId, append }));
      }}
      onDeleteEdge={(edgeId) => {
        onDeleteEdge(edgeId);
        setGraph((current) => nodesCanvasReducer(current, { type: "delete_edge", edgeId }));
      }}
      onDeleteNode={(nodeId) => {
        setGraph((current) => nodesCanvasReducer(current, { type: "delete_node", nodeId }));
      }}
    />
  );
};
