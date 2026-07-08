import type { FunctionComponent } from "preact";
import type { NodeCanvasGraph } from "../../lib/nodes-canvas-state.js";
import { NODE_CANVAS_NODE_HEIGHT, NODE_CANVAS_NODE_WIDTH } from "./NodeCanvasNodeCard.js";

interface NodeCanvasMinimapProps {
  graph: NodeCanvasGraph;
  viewport: { x: number; y: number; zoom: number };
  viewportSize: { width: number; height: number };
  bounds: { minX: number; minY: number; width: number; height: number };
}

const MINIMAP_WIDTH = 168;
const MINIMAP_HEIGHT = 104;

export const NodeCanvasMinimap: FunctionComponent<NodeCanvasMinimapProps> = ({
  graph,
  viewport,
  viewportSize,
  bounds,
}) => {
  const scale = Math.min(
    MINIMAP_WIDTH / Math.max(1, bounds.width),
    MINIMAP_HEIGHT / Math.max(1, bounds.height),
  );
  const offsetX = (MINIMAP_WIDTH - bounds.width * scale) / 2;
  const offsetY = (MINIMAP_HEIGHT - bounds.height * scale) / 2;
  const toMiniX = (x: number): number => offsetX + (x - bounds.minX) * scale;
  const toMiniY = (y: number): number => offsetY + (y - bounds.minY) * scale;
  const viewX = toMiniX(-viewport.x / viewport.zoom);
  const viewY = toMiniY(-viewport.y / viewport.zoom);
  const viewWidth = Math.min(MINIMAP_WIDTH, (viewportSize.width / viewport.zoom) * scale);
  const viewHeight = Math.min(MINIMAP_HEIGHT, (viewportSize.height / viewport.zoom) * scale);
  const selectedNodeIds = new Set(graph.selection.nodeIds);

  return (
    <div className="absolute bottom-3 right-3 z-20 hidden rounded-[0.85rem] border border-black/[0.08] bg-white/88 p-2 shadow-[0_12px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/[0.10] dark:bg-void-900/82 sm:block">
      <svg
        role="img"
        aria-label="Node canvas minimap"
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        className="block"
      >
        <rect width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} rx="10" className="fill-slate-100 dark:fill-void-800" />
        {graph.edges.map((edge) => {
          const source = graph.nodes.find((node) => node.id === edge.source.nodeId);
          const target = graph.nodes.find((node) => node.id === edge.target.nodeId);
          if (!source || !target) {
            return null;
          }
          return (
            <line
              key={edge.id}
              x1={toMiniX(source.position.x + NODE_CANVAS_NODE_WIDTH)}
              y1={toMiniY(source.position.y + NODE_CANVAS_NODE_HEIGHT / 2)}
              x2={toMiniX(target.position.x)}
              y2={toMiniY(target.position.y + NODE_CANVAS_NODE_HEIGHT / 2)}
              className="stroke-slate-300 dark:stroke-slate-600"
              strokeWidth="1.25"
            />
          );
        })}
        {graph.nodes.map((node) => (
          <rect
            key={node.id}
            x={toMiniX(node.position.x)}
            y={toMiniY(node.position.y)}
            width={Math.max(5, NODE_CANVAS_NODE_WIDTH * scale)}
            height={Math.max(4, NODE_CANVAS_NODE_HEIGHT * scale)}
            rx="2"
            className={selectedNodeIds.has(node.id) ? "fill-signal-500" : "fill-slate-500 dark:fill-slate-300"}
          />
        ))}
        <rect
          x={Number.isFinite(viewX) ? viewX : 0}
          y={Number.isFinite(viewY) ? viewY : 0}
          width={Math.max(8, viewWidth)}
          height={Math.max(8, viewHeight)}
          rx="3"
          className="fill-transparent stroke-signal-500"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
};
