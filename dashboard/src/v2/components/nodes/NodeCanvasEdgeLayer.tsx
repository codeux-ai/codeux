import type { FunctionComponent, JSX } from "preact";
import type {
  NodeCanvasEdge,
  NodeCanvasGraph,
  NodeCanvasNode,
  NodeCanvasValidationIssue,
} from "../../lib/nodes-canvas-state.js";
import {
  getNodeCanvasPortOffsetY,
  NODE_CANVAS_NODE_HEIGHT,
  NODE_CANVAS_NODE_WIDTH,
} from "./NodeCanvasNodeCard.js";

interface NodeCanvasEdgeLayerProps {
  graph: NodeCanvasGraph;
  width: number;
  height: number;
  validationIssues: readonly NodeCanvasValidationIssue[];
  onSelectEdge?: (edgeId: string, append: boolean) => void;
}

export const NodeCanvasEdgeLayer: FunctionComponent<NodeCanvasEdgeLayerProps> = ({
  graph,
  width,
  height,
  validationIssues,
  onSelectEdge,
}) => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedEdgeIds = new Set(graph.selection.edgeIds);
  const invalidEdgeIds = new Set(validationIssues.map((issue) => issue.entityId));

  return (
    <svg
      aria-label="Node canvas edges"
      className="absolute inset-0 h-full w-full overflow-visible"
      width={width}
      height={height}
      role="group"
    >
      <defs>
        <marker id="node-canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400 dark:fill-slate-500" />
        </marker>
        <marker id="node-canvas-arrow-selected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-signal-500" />
        </marker>
      </defs>

      {graph.edges.map((edge) => {
        const geometry = getEdgeGeometry(edge, nodeById);
        if (!geometry) {
          return null;
        }
        const selected = selectedEdgeIds.has(edge.id);
        const invalid = invalidEdgeIds.has(edge.id);
        const label = edge.label ?? `${edge.source.nodeId} to ${edge.target.nodeId}`;
        return (
          <g
            key={edge.id}
            role="button"
            tabIndex={0}
            data-node-canvas-interactive="true"
            aria-label={`Select edge ${label}`}
            aria-pressed={selected}
            onClick={(event: JSX.TargetedMouseEvent<SVGGElement>) => {
              event.stopPropagation();
              onSelectEdge?.(edge.id, event.shiftKey || event.metaKey);
            }}
            onKeyDown={(event: JSX.TargetedKeyboardEvent<SVGGElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectEdge?.(edge.id, event.shiftKey || event.metaKey);
              }
            }}
            className="cursor-pointer focus:outline-none"
          >
            <path
              d={geometry.path}
              className="fill-none stroke-transparent"
              strokeWidth="18"
            />
            <path
              d={geometry.path}
              className={`fill-none transition-[stroke,stroke-width,opacity] motion-reduce:transition-none ${
                selected
                  ? "stroke-signal-500"
                  : invalid
                    ? "stroke-status-red"
                    : "stroke-slate-300 dark:stroke-slate-600"
              }`}
              strokeWidth={selected ? 3 : 2}
              strokeLinecap="round"
              markerEnd={selected ? "url(#node-canvas-arrow-selected)" : "url(#node-canvas-arrow)"}
            />
            {edge.label ? (
              <text
                x={geometry.labelX}
                y={geometry.labelY}
                textAnchor="middle"
                className="pointer-events-none fill-slate-500 text-[11px] font-semibold dark:fill-slate-400"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

const getEdgeGeometry = (
  edge: NodeCanvasEdge,
  nodeById: ReadonlyMap<string, NodeCanvasNode>,
): { path: string; labelX: number; labelY: number } | null => {
  const source = nodeById.get(edge.source.nodeId);
  const target = nodeById.get(edge.target.nodeId);
  if (!source || !target) {
    return null;
  }

  const sourcePortIndex = Math.max(0, source.outputPorts.findIndex((port) => port.id === edge.source.portId));
  const targetPortIndex = Math.max(0, target.inputPorts.findIndex((port) => port.id === edge.target.portId));
  const startX = source.position.x + NODE_CANVAS_NODE_WIDTH + 4;
  const startY = source.position.y + getNodeCanvasPortOffsetY("output", sourcePortIndex, source.outputPorts.length);
  const endX = target.position.x - 4;
  const endY = target.position.y + getNodeCanvasPortOffsetY("input", targetPortIndex, target.inputPorts.length);
  const curve = Math.max(72, Math.abs(endX - startX) * 0.42);
  const path = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;

  return {
    path,
    labelX: (startX + endX) / 2,
    labelY: Math.min(startY, endY) - NODE_CANVAS_NODE_HEIGHT * 0.08,
  };
};
