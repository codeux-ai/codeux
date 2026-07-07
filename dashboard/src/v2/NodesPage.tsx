import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileJson,
  RefreshCcw,
  RotateCcw,
  Upload,
  Workflow,
} from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { NodeCanvas } from "./components/nodes/NodeCanvas.js";
import { NodeInspector } from "./components/nodes/NodeInspector.js";
import { NodePalette } from "./components/nodes/NodePalette.js";
import { NodeValidationPanel } from "./components/nodes/NodeValidationPanel.js";
import { Button } from "./components/ui/Button.js";
import type {
  NodeCanvasConfigValue,
  NodeCanvasEdge,
  NodeCanvasGraph,
  NodeCanvasNode,
  NodesCanvasAction,
} from "./lib/nodes-canvas-state.js";
import {
  createInitialNodeCanvasGraph,
  nodesCanvasReducer,
  serializeNodeCanvasGraph,
  validateNodeCanvasGraph,
} from "./lib/nodes-canvas-state.js";
import {
  applyNodeCanvasAgentCommand,
  buildNodeCanvasAgentSummary,
} from "./lib/nodes-agent-surface.js";

export const NODES_CANVAS_STORAGE_KEY = "codeux:nodes-canvas:v1";

type FeedbackTone = "success" | "error" | "info" | "warning";

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

const panelClass = "rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035]";

const toneClasses: Record<FeedbackTone, string> = {
  success: "border-status-green/20 bg-status-green/[0.08] text-slate-700 dark:text-slate-200",
  error: "border-status-red/25 bg-status-red/[0.08] text-slate-700 dark:text-slate-200",
  info: "border-signal-500/20 bg-signal-500/[0.08] text-slate-700 dark:text-slate-200",
  warning: "border-amber-500/25 bg-amber-500/[0.08] text-slate-700 dark:text-slate-200",
};

const loadPersistedGraph = (): NodeCanvasGraph => {
  if (typeof window === "undefined") {
    return createInitialNodeCanvasGraph();
  }

  const persisted = window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY);
  if (!persisted) {
    return createInitialNodeCanvasGraph();
  }

  const result = applyNodeCanvasAgentCommand(createInitialNodeCanvasGraph(), {
    command: "replace_graph",
    serializedGraph: persisted,
  });

  return result.issues.some((issue) => issue.field === "serializedGraph")
    ? createInitialNodeCanvasGraph()
    : result.graph;
};

const selectedNodeFromGraph = (graph: NodeCanvasGraph): NodeCanvasNode | null => {
  const selectedId = graph.selection.nodeIds[0];
  return selectedId ? graph.nodes.find((node) => node.id === selectedId) ?? null : null;
};

const selectedEdgeFromGraph = (graph: NodeCanvasGraph): NodeCanvasEdge | null => {
  const selectedId = graph.selection.edgeIds[0];
  return selectedId ? graph.edges.find((edge) => edge.id === selectedId) ?? null : null;
};

const updateNodePatch = (
  graph: NodeCanvasGraph,
  nodeId: string,
  patch: Partial<Pick<NodeCanvasNode, "description" | "label" | "metadata">>,
): NodeCanvasGraph => {
  let nextGraph = graph;
  if (patch.label !== undefined) {
    nextGraph = nodesCanvasReducer(nextGraph, { type: "update_node_label", nodeId, label: patch.label });
  }

  if (patch.description !== undefined || patch.metadata !== undefined) {
    nextGraph = nodesCanvasReducer(nextGraph, {
      type: "replace_graph",
      graph: {
        ...nextGraph,
        nodes: nextGraph.nodes.map((node) => node.id === nodeId
          ? {
              ...node,
              ...(patch.description !== undefined ? { description: patch.description } : {}),
              ...(patch.metadata !== undefined ? { metadata: { ...node.metadata, ...patch.metadata } } : {}),
            }
          : node),
      },
    });
  }

  return nextGraph;
};

const formatSummaryJson = (graph: NodeCanvasGraph): string => (
  JSON.stringify(buildNodeCanvasAgentSummary(graph), null, 2)
);

export const NodesPage: FunctionComponent = () => {
  const [graph, setGraph] = useState<NodeCanvasGraph>(() => loadPersistedGraph());
  const [exchangeJson, setExchangeJson] = useState(() => serializeNodeCanvasGraph(graph));
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: "info",
    message: "Canvas restored from local browser storage.",
  });
  const [enabledNodeIds, setEnabledNodeIds] = useState<Set<string>>(() => new Set(graph.nodes.map((node) => node.id)));

  const validationIssues = useMemo(() => validateNodeCanvasGraph(graph), [graph]);
  const summary = useMemo(() => buildNodeCanvasAgentSummary(graph), [graph]);
  const selectedNode = useMemo(() => selectedNodeFromGraph(graph), [graph]);
  const selectedEdge = useMemo(() => selectedEdgeFromGraph(graph), [graph]);
  const serializedGraph = useMemo(() => serializeNodeCanvasGraph(graph), [graph]);
  const summaryJson = useMemo(() => formatSummaryJson(graph), [graph]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(NODES_CANVAS_STORAGE_KEY, serializedGraph);
  }, [serializedGraph]);

  const dispatch = useCallback((action: NodesCanvasAction): void => {
    setGraph((current) => nodesCanvasReducer(current, action));
  }, []);

  const handleExport = (): void => {
    setExchangeJson(serializedGraph);
    setFeedback({
      tone: validationIssues.length === 0 ? "success" : "warning",
      message: `Exported ${summary.nodeCount} nodes and ${summary.edgeCount} edges as deterministic JSON.`,
    });
  };

  const handleImport = (): void => {
    const result = applyNodeCanvasAgentCommand(graph, {
      command: "replace_graph",
      serializedGraph: exchangeJson,
    });
    const importIssues = result.issues.filter((issue) => issue.entityId.startsWith("command[0]"));
    if (importIssues.length > 0) {
      setFeedback({ tone: "error", message: importIssues[0]?.message ?? "Import failed." });
      return;
    }

    setGraph(result.graph);
    setEnabledNodeIds(new Set(result.graph.nodes.map((node) => node.id)));
    const nextIssueCount = validateNodeCanvasGraph(result.graph).length;
    setFeedback({
      tone: nextIssueCount === 0 ? "success" : "warning",
      message: nextIssueCount === 0
        ? "Imported graph JSON and saved it locally."
        : `Imported graph JSON with ${nextIssueCount} validation issue${nextIssueCount === 1 ? "" : "s"}.`,
    });
  };

  const handleReset = (): void => {
    const nextGraph = createInitialNodeCanvasGraph();
    setGraph(nextGraph);
    setExchangeJson(serializeNodeCanvasGraph(nextGraph));
    setEnabledNodeIds(new Set(nextGraph.nodes.map((node) => node.id)));
    setFeedback({ tone: "info", message: "Canvas reset to the starter workflow." });
  };

  const handleClear = (): void => {
    setGraph({ nodes: [], edges: [], selection: { nodeIds: [], edgeIds: [] } });
    setEnabledNodeIds(new Set());
    setFeedback({ tone: "info", message: "Canvas cleared. Add a node from the palette to start again." });
  };

  const handleNodeChange = (
    nodeId: string,
    patch: Partial<Pick<NodeCanvasNode, "description" | "label" | "metadata">>,
  ): void => {
    setGraph((current) => updateNodePatch(current, nodeId, patch));
  };

  const handleNodeConfigChange = (nodeId: string, fieldId: string, value: NodeCanvasConfigValue): void => {
    dispatch({ type: "update_node_config", nodeId, fieldId, value });
  };

  const handleNodeEnabledChange = (nodeId: string, enabled: boolean): void => {
    setEnabledNodeIds((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return next;
    });
    setFeedback({ tone: "info", message: `${enabled ? "Enabled" : "Disabled"} ${nodeId} for this editing session.` });
  };

  const selectNode = (nodeId: string, append = false): void => dispatch({ type: "select_node", nodeId, append });
  const selectEdge = (edgeId: string, append = false): void => dispatch({ type: "select_edge", edgeId, append });

  const statusIcon = validationIssues.length === 0 ? CheckCircle2 : AlertTriangle;
  const StatusIcon = statusIcon;

  return (
    <PageContainer
      aria-labelledby="nodes-canvas-title"
      className="gap-5"
      padding="workbench"
    >
      <PageHeader
        icon={Workflow}
        eyebrow="Nodes"
        title={<span id="nodes-canvas-title">Nodes Canvas</span>}
        subtitle="Compose local workflow graphs with typed nodes, reducer-backed edits, validation feedback, and JSON exchange for agents."
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" icon={Download} onClick={handleExport}>
              Export JSON
            </Button>
            <Button type="button" size="sm" variant="secondary" icon={Upload} onClick={handleImport}>
              Import JSON
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={RefreshCcw} onClick={handleClear}>
              Clear
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={RotateCcw} onClick={handleReset}>
              Reset
            </Button>
          </>
        )}
      />

      <section
        aria-label="Node canvas status"
        className={`${panelClass} flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-ui)] bg-slate-900/[0.06] text-slate-600 dark:bg-white/[0.08] dark:text-slate-200">
            <StatusIcon className={validationIssues.length === 0 ? "h-4 w-4 text-status-green" : "h-4 w-4 text-status-red"} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {validationIssues.length === 0 ? "Graph is structurally valid" : `${validationIssues.length} validation issue${validationIssues.length === 1 ? "" : "s"}`}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {summary.nodeCount} nodes, {summary.edgeCount} edges, {summary.selectedNodeIds.length + summary.selectedEdgeIds.length} selected. Saved locally under <code>{NODES_CANVAS_STORAGE_KEY}</code>.
            </p>
          </div>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`rounded-[var(--radius-ui)] border px-3 py-2 text-sm ${toneClasses[feedback.tone]}`}
        >
          {feedback.message}
        </p>
      </section>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <NodePalette
          onCreateNode={(action) => {
            dispatch(action);
            setFeedback({ tone: "success", message: `Added ${action.kind} node.` });
          }}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <NodeCanvas
            graph={graph}
            validationIssues={validationIssues}
            onSelectNode={selectNode}
            onSelectEdge={selectEdge}
            onClearSelection={() => dispatch({ type: "clear_selection" })}
            onDeleteNode={(nodeId) => dispatch({ type: "delete_node", nodeId })}
            onDeleteEdge={(edgeId) => dispatch({ type: "delete_edge", edgeId })}
            onMoveNode={(nodeId, position) => dispatch({ type: "move_node", nodeId, position })}
          />
          {graph.nodes.length === 0 ? (
            <div className={`${panelClass} flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400`} role="status">
              <FileJson className="h-4 w-4 shrink-0 text-signal-500" aria-hidden="true" />
              The canvas is empty. Palette actions and valid imported JSON can rebuild it.
            </div>
          ) : null}
          <NodeValidationPanel
            graph={graph}
            onSelectNode={(nodeId) => selectNode(nodeId)}
            onSelectEdge={(edgeId) => selectEdge(edgeId)}
            onFocusNode={(nodeId) => {
              selectNode(nodeId);
              setFeedback({ tone: "info", message: `Selected node ${nodeId}.` });
            }}
            onFocusEdge={(edgeId) => {
              selectEdge(edgeId);
              setFeedback({ tone: "info", message: `Selected edge ${edgeId}.` });
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <NodeInspector
            graph={graph}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            selectedNodeEnabled={selectedNode ? enabledNodeIds.has(selectedNode.id) : true}
            validationIssues={validationIssues}
            onNodeChange={handleNodeChange}
            onNodeConfigChange={handleNodeConfigChange}
            onNodeEnabledChange={handleNodeEnabledChange}
            onSelectNode={(nodeId) => selectNode(nodeId)}
            onSelectEdge={(edgeId) => selectEdge(edgeId)}
          />

          <section className={`${panelClass} flex flex-col gap-3`} aria-labelledby="nodes-json-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">Exchange</p>
                <h2 id="nodes-json-heading" className="text-base font-bold text-slate-900 dark:text-white">Graph JSON</h2>
              </div>
              <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="nodes-graph-json">
              Import or exported graph
            </label>
            <textarea
              id="nodes-graph-json"
              className="min-h-56 w-full resize-y rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3 py-2 font-mono text-xs leading-relaxed text-slate-700 outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] dark:text-slate-200"
              spellcheck={false}
              value={exchangeJson}
              onInput={(event) => setExchangeJson(event.currentTarget.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" icon={Download} onClick={handleExport}>
                Export
              </Button>
              <Button type="button" size="sm" variant="signal" icon={Upload} onClick={handleImport}>
                Import
              </Button>
            </div>
          </section>

          <section className={`${panelClass} flex flex-col gap-3`} aria-labelledby="nodes-agent-heading">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">Agent surface</p>
              <h2 id="nodes-agent-heading" className="text-base font-bold text-slate-900 dark:text-white">Command metadata</h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Agents can use add_node, patch_node, connect_ports, delete_entities, select_entities, and replace_graph commands against this graph contract.
            </p>
            <pre className="max-h-72 overflow-auto rounded-[var(--radius-ui)] border border-black/[0.06] bg-slate-950 p-3 text-xs leading-relaxed text-slate-100 dark:border-white/[0.08]">
              {summaryJson}
            </pre>
          </section>
        </div>
      </div>
    </PageContainer>
  );
};
