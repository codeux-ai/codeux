import type { FunctionComponent, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { NodeFlowGraph } from "../../types.js";
import {
  layoutNodeFlowGraph,
  NODE_FLOW_NODE_HEIGHT,
  NODE_FLOW_NODE_WIDTH,
  type NodeFlowCanvasNode,
} from "../../lib/node-flow-view-models.js";

interface NodeFlowCanvasProps {
  graph: NodeFlowGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
}

export const NodeFlowCanvas: FunctionComponent<NodeFlowCanvasProps> = ({
  graph,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ nodeId: string; position: { x: number; y: number } } | null>(null);
  const [drag, setDrag] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
    position: { x: number; y: number } | null;
  } | null>(null);
  const canvasGraph = useMemo(() => layoutNodeFlowGraph(graph), [graph]);
  const displayedNodes = useMemo(() => canvasGraph.nodes.map((node) => (
    drag?.nodeId === node.id && drag.position ? { ...node, position: drag.position } : node
  )), [canvasGraph.nodes, drag]);
  const nodeById = useMemo(() => new Map(displayedNodes.map((node) => [node.id, node])), [displayedNodes]);
  const maxX = Math.max(720, ...displayedNodes.map((node) => node.position.x + NODE_FLOW_NODE_WIDTH + 80));
  const maxY = Math.max(420, ...displayedNodes.map((node) => node.position.y + NODE_FLOW_NODE_HEIGHT + 80));

  useEffect(() => () => {
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
  }, []);

  const handlePointerMove = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!drag || !canvasRef.current) {
      return;
    }
    const bounds = canvasRef.current.getBoundingClientRect();
    const position = {
      x: Math.max(24, event.clientX - bounds.left + canvasRef.current.scrollLeft - drag.offsetX),
      y: Math.max(24, event.clientY - bounds.top + canvasRef.current.scrollTop - drag.offsetY),
    };
    pendingDragRef.current = { nodeId: drag.nodeId, position };
    if (dragFrameRef.current === null) {
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        if (pending) {
          const { nodeId, position: pendingPosition } = pending;
          setDrag((current) => current?.nodeId === nodeId ? { ...current, position: pendingPosition } : current);
        }
      });
    }
  };

  const finishDrag = (): void => {
    const pending = pendingDragRef.current;
    const position = pending && pending.nodeId === drag?.nodeId ? pending.position : drag?.position;
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null; pendingDragRef.current = null;
    if (drag && position) onMoveNode(drag.nodeId, position);
    setDrag(null);
  };

  const cancelDrag = (): void => {
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null; pendingDragRef.current = null; setDrag(null);
  };

  return (
    <section
      aria-label="Node flow canvas"
      className="relative min-h-[26rem] overflow-auto rounded-[1.6rem] border border-black/[0.08] bg-white/85 shadow-[0_18px_52px_rgba(15,23,42,0.06)] dark:border-white/[0.08] dark:bg-void-800/90"
      ref={canvasRef}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
    >
      <div className="relative" style={{ width: `${maxX}px`, height: `${maxY}px` }}>
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          width={maxX}
          height={maxY}
        >
          <defs>
            <marker id="node-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-300 dark:fill-slate-600" />
            </marker>
          </defs>
          {canvasGraph.edges.map((edge, index) => {
            const from = nodeById.get(edge.fromNodeId);
            const to = nodeById.get(edge.toNodeId);
            if (!from || !to) {
              return null;
            }
            const startX = from.position.x + NODE_FLOW_NODE_WIDTH;
            const startY = from.position.y + NODE_FLOW_NODE_HEIGHT / 2;
            const endX = to.position.x;
            const endY = to.position.y + NODE_FLOW_NODE_HEIGHT / 2;
            const curve = Math.max(80, Math.abs(endX - startX) / 2);
            return (
              <path
                key={edge.id ?? `${edge.fromNodeId}-${edge.toNodeId}-${index}`}
                d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`}
                className="fill-none stroke-slate-300 dark:stroke-slate-600"
                strokeWidth="2"
                markerEnd="url(#node-flow-arrow)"
              />
            );
          })}
        </svg>

        {displayedNodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            onSelect={() => onSelectNode(node.id)}
            onPointerDown={(event) => {
              const target = event.currentTarget;
              target.setPointerCapture(event.pointerId);
              const bounds = target.getBoundingClientRect();
              onSelectNode(node.id);
              pendingDragRef.current = null;
              setDrag({
                nodeId: node.id,
                offsetX: event.clientX - bounds.left,
                offsetY: event.clientY - bounds.top,
                position: null,
              });
            }}
          />
        ))}
      </div>
    </section>
  );
};

const CanvasNode: FunctionComponent<{
  node: NodeFlowCanvasNode;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
}> = ({ node, selected, onSelect, onPointerDown }) => {
  return (
    <button
      type="button"
      aria-label={`Select node ${node.title}`}
      aria-pressed={selected}
      className={`absolute flex touch-none select-none flex-col items-start justify-between rounded-[1.35rem] border p-4 text-left shadow-sm transition-[border-color,box-shadow,transform,background-color] motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${
        selected
          ? "border-signal-500/60 bg-signal-500/[0.10] shadow-[0_0_0_1px_rgba(0,224,160,0.26),0_18px_40px_rgba(0,224,160,0.10)]"
          : "border-black/[0.08] bg-white/88 hover:border-signal-500/35 dark:border-white/[0.08] dark:bg-void-800/88"
      }`}
      style={{
        width: `${NODE_FLOW_NODE_WIDTH}px`,
        height: `${NODE_FLOW_NODE_HEIGHT}px`,
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      }}
      onClick={onSelect}
      onPointerDown={onPointerDown}
    >
      <span className="max-w-full truncate text-[11px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">{node.type}</span>
      <span className="max-w-full break-words text-base font-bold leading-tight text-slate-900 dark:text-white">{node.title}</span>
      <span className="line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {node.description || `${node.widgetSchema?.fields.length ?? 0} widgets`}
      </span>
    </button>
  );
};
