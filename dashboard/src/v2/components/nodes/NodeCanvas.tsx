import type { FunctionComponent, JSX } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Loader2, Workflow } from "lucide-preact";
import type {
  NodeCanvasGraph,
  NodeCanvasNode,
  NodeCanvasValidationIssue,
} from "../../lib/nodes-canvas-state.js";
import { validateNodeCanvasGraph } from "../../lib/nodes-canvas-state.js";
import { EmptyState } from "../ui/EmptyState.js";
import { NodeCanvasEdgeLayer } from "./NodeCanvasEdgeLayer.js";
import { NodeCanvasMinimap } from "./NodeCanvasMinimap.js";
import {
  NODE_CANVAS_NODE_HEIGHT,
  NODE_CANVAS_NODE_WIDTH,
  NodeCanvasNodeCard,
} from "./NodeCanvasNodeCard.js";
import { NodeCanvasToolbar } from "./NodeCanvasToolbar.js";

interface NodeCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface NodeCanvasProps {
  graph: NodeCanvasGraph;
  validationIssues?: readonly NodeCanvasValidationIssue[];
  loading?: boolean;
  className?: string;
  onSelectNode?: (nodeId: string, append: boolean) => void;
  onSelectEdge?: (edgeId: string, append: boolean) => void;
  onClearSelection?: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number }) => void;
}

const DEFAULT_VIEWPORT: NodeCanvasViewport = { x: 32, y: 64, zoom: 1 };
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.6;
const CONTENT_PADDING = 120;
const DEFAULT_VIEWPORT_SIZE = { width: 960, height: 540 };

export const NodeCanvas: FunctionComponent<NodeCanvasProps> = ({
  graph,
  validationIssues,
  loading = false,
  className = "",
  onSelectNode,
  onSelectEdge,
  onClearSelection,
  onDeleteNode,
  onDeleteEdge,
  onMoveNode,
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [viewport, setViewport] = useState<NodeCanvasViewport>(DEFAULT_VIEWPORT);
  const [viewportSize, setViewportSize] = useState(DEFAULT_VIEWPORT_SIZE);
  const [panDrag, setPanDrag] = useState<{ pointerId: number; startX: number; startY: number; viewport: NodeCanvasViewport } | null>(null);
  const [nodeDrag, setNodeDrag] = useState<{ pointerId: number; nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(graph.selection.nodeIds[0] ?? graph.nodes[0]?.id ?? null);

  const issues = useMemo(() => validationIssues ?? validateNodeCanvasGraph(graph), [graph, validationIssues]);
  const issuesByNodeId = useMemo(() => {
    const grouped = new Map<string, NodeCanvasValidationIssue[]>();
    for (const issue of issues) {
      const next = grouped.get(issue.entityId) ?? [];
      next.push(issue);
      grouped.set(issue.entityId, next);
    }
    return grouped;
  }, [issues]);
  const bounds = useMemo(() => getGraphBounds(graph.nodes), [graph.nodes]);
  const selectedNodeIds = useMemo(() => new Set(graph.selection.nodeIds), [graph.selection.nodeIds]);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }

    const updateSize = (): void => {
      setViewportSize({
        width: element.clientWidth || DEFAULT_VIEWPORT_SIZE.width,
        height: element.clientHeight || DEFAULT_VIEWPORT_SIZE.height,
      });
    };
    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const setNodeRef = useCallback((nodeId: string, element: HTMLButtonElement | null): void => {
    if (element) {
      nodeRefs.current.set(nodeId, element);
    } else {
      nodeRefs.current.delete(nodeId);
    }
  }, []);

  const screenToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left - viewport.x) / viewport.zoom,
      y: (clientY - top - viewport.y) / viewport.zoom,
    };
  }, [viewport]);

  const fitView = useCallback((): void => {
    if (graph.nodes.length === 0) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }
    const zoom = clamp(Math.min(
      (viewportSize.width - 64) / Math.max(1, bounds.width),
      (viewportSize.height - 64) / Math.max(1, bounds.height),
    ), MIN_ZOOM, MAX_ZOOM);
    setViewport({
      zoom,
      x: (viewportSize.width - bounds.width * zoom) / 2 - bounds.minX * zoom,
      y: (viewportSize.height - bounds.height * zoom) / 2 - bounds.minY * zoom,
    });
  }, [bounds, graph.nodes.length, viewportSize.height, viewportSize.width]);

  const zoomBy = (delta: number): void => {
    setViewport((current) => ({ ...current, zoom: clamp(current.zoom + delta, MIN_ZOOM, MAX_ZOOM) }));
  };

  const handleSurfacePointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewport,
    });
    onClearSelection?.();
  };

  const handleNodePointerDown = (
    node: NodeCanvasNode,
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
  ): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectNode?.(node.id, event.shiftKey || event.metaKey);
    setFocusedNodeId(node.id);
    const world = screenToWorld(event.clientX, event.clientY);
    setNodeDrag({
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: world.x - node.position.x,
      offsetY: world.y - node.position.y,
    });
  };

  const handlePointerMove = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (nodeDrag && nodeDrag.pointerId === event.pointerId) {
      const world = screenToWorld(event.clientX, event.clientY);
      onMoveNode?.(nodeDrag.nodeId, {
        x: Math.max(0, Math.round(world.x - nodeDrag.offsetX)),
        y: Math.max(0, Math.round(world.y - nodeDrag.offsetY)),
      });
      return;
    }
    if (panDrag && panDrag.pointerId === event.pointerId) {
      setViewport({
        ...panDrag.viewport,
        x: panDrag.viewport.x + event.clientX - panDrag.startX,
        y: panDrag.viewport.y + event.clientY - panDrag.startY,
      });
    }
  };

  const stopDragging = (): void => {
    setPanDrag(null);
    setNodeDrag(null);
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (graph.selection.nodeIds.length > 0 || graph.selection.edgeIds.length > 0) {
        event.preventDefault();
        for (const edgeId of graph.selection.edgeIds) {
          onDeleteEdge?.(edgeId);
        }
        for (const nodeId of graph.selection.nodeIds) {
          onDeleteNode?.(nodeId);
        }
      }
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      const nextNode = findNextNode(graph.nodes, focusedNodeId ?? graph.selection.nodeIds[0] ?? null, event.key);
      if (nextNode) {
        event.preventDefault();
        setFocusedNodeId(nextNode.id);
        onSelectNode?.(nextNode.id, false);
        requestAnimationFrameSafe(() => nodeRefs.current.get(nextNode.id)?.focus());
      }
    }
  };

  if (loading) {
    return (
      <section
        aria-label="Node canvas loading"
        className={`relative min-h-[30rem] overflow-hidden rounded-[1.35rem] border border-black/[0.08] bg-white/60 shadow-[0_20px_70px_rgba(15,23,42,0.08)] dark:border-white/[0.08] dark:bg-white/[0.035] ${className}`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="relative flex min-h-[30rem] items-center justify-center">
          <div className="flex items-center gap-3 rounded-[1rem] border border-black/[0.08] bg-white/88 px-4 py-3 text-sm font-semibold text-slate-600 shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:border-white/[0.10] dark:bg-void-900/82 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading node canvas
          </div>
        </div>
      </section>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <section
        aria-label="Empty node canvas"
        className={`relative min-h-[30rem] overflow-hidden rounded-[1.35rem] border border-dashed border-black/[0.12] bg-white/55 dark:border-white/[0.14] dark:bg-white/[0.035] ${className}`}
      >
        <EmptyState
          icon={<Workflow className="h-7 w-7" aria-hidden="true" />}
          title="No nodes on this canvas"
          description="Add nodes from the parent panel to start building a workflow graph."
        />
      </section>
    );
  }

  const contentWidth = Math.max(DEFAULT_VIEWPORT_SIZE.width, bounds.minX + bounds.width + CONTENT_PADDING);
  const contentHeight = Math.max(DEFAULT_VIEWPORT_SIZE.height, bounds.minY + bounds.height + CONTENT_PADDING);

  return (
    <section
      ref={surfaceRef}
      role="application"
      tabIndex={0}
      aria-label="Node canvas"
      className={`relative min-h-[30rem] touch-none overflow-hidden rounded-[1.35rem] border border-black/[0.08] bg-slate-50/90 shadow-[0_20px_70px_rgba(15,23,42,0.08)] outline-none focus-visible:ring-2 focus-visible:ring-signal-500/55 dark:border-white/[0.08] dark:bg-void-950/70 ${panDrag ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(100,116,139,0.10)_1px,transparent_1px),linear-gradient(rgba(100,116,139,0.10)_1px,transparent_1px)] bg-[size:32px_32px] dark:opacity-45" />
      <NodeCanvasToolbar
        zoom={viewport.zoom}
        onZoomOut={() => zoomBy(-0.1)}
        onZoomIn={() => zoomBy(0.1)}
        onResetView={() => setViewport(DEFAULT_VIEWPORT)}
        onFitView={fitView}
      />
      <div
        className="absolute left-0 top-0"
        style={{
          width: `${contentWidth}px`,
          height: `${contentHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <NodeCanvasEdgeLayer
          graph={graph}
          width={contentWidth}
          height={contentHeight}
          validationIssues={issues}
          onSelectEdge={(edgeId, append) => {
            setFocusedNodeId(null);
            onSelectEdge?.(edgeId, append);
          }}
        />
        {graph.nodes.map((node) => (
          <NodeCanvasNodeCard
            key={node.id}
            node={node}
            selected={selectedNodeIds.has(node.id)}
            focused={focusedNodeId === node.id}
            validationIssues={issuesByNodeId.get(node.id) ?? []}
            setNodeRef={setNodeRef}
            onSelect={(event) => {
              event.stopPropagation();
              setFocusedNodeId(node.id);
              onSelectNode?.(node.id, event.shiftKey || event.metaKey);
            }}
            onPointerDown={(event) => handleNodePointerDown(node, event)}
          />
        ))}
      </div>
      <NodeCanvasMinimap
        graph={graph}
        viewport={viewport}
        viewportSize={viewportSize}
        bounds={bounds}
      />
    </section>
  );
};

const getGraphBounds = (nodes: readonly NodeCanvasNode[]): { minX: number; minY: number; width: number; height: number } => {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, width: DEFAULT_VIEWPORT_SIZE.width, height: DEFAULT_VIEWPORT_SIZE.height };
  }
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_CANVAS_NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => node.position.y + NODE_CANVAS_NODE_HEIGHT));
  return {
    minX: Math.max(0, minX - CONTENT_PADDING / 2),
    minY: Math.max(0, minY - CONTENT_PADDING / 2),
    width: maxX - Math.max(0, minX - CONTENT_PADDING / 2) + CONTENT_PADDING / 2,
    height: maxY - Math.max(0, minY - CONTENT_PADDING / 2) + CONTENT_PADDING / 2,
  };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isInteractiveTarget = (target: EventTarget | null): boolean => (
  target instanceof Element && target.closest("[data-node-canvas-interactive='true']") !== null
);

const findNextNode = (
  nodes: readonly NodeCanvasNode[],
  currentNodeId: string | null,
  key: string,
): NodeCanvasNode | null => {
  if (nodes.length === 0) {
    return null;
  }
  const ordered = [...nodes].sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y || left.id.localeCompare(right.id));
  const current = ordered.find((node) => node.id === currentNodeId) ?? ordered[0];
  const directional = ordered
    .filter((node) => node.id !== current.id)
    .map((node) => ({
      node,
      dx: node.position.x - current.position.x,
      dy: node.position.y - current.position.y,
    }))
    .filter(({ dx, dy }) => {
      if (key === "ArrowRight") return dx > 0;
      if (key === "ArrowLeft") return dx < 0;
      if (key === "ArrowDown") return dy > 0;
      return dy < 0;
    })
    .sort((left, right) => {
      if (key === "ArrowRight" || key === "ArrowLeft") {
        return Math.abs(left.dx) - Math.abs(right.dx) || Math.abs(left.dy) - Math.abs(right.dy);
      }
      return Math.abs(left.dy) - Math.abs(right.dy) || Math.abs(left.dx) - Math.abs(right.dx);
    });

  if (directional[0]) {
    return directional[0].node;
  }

  const index = ordered.findIndex((node) => node.id === current.id);
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return ordered[(index - 1 + ordered.length) % ordered.length] ?? null;
  }
  return ordered[(index + 1) % ordered.length] ?? null;
};

const requestAnimationFrameSafe = (callback: () => void): void => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  callback();
};
