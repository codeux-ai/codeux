import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AlertTriangle, GitBranch, Plus, Save, ShieldCheck, Workflow } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { NodeFlowCanvas } from "./components/nodes/NodeFlowCanvas.js";
import { NodeFlowInspector } from "./components/nodes/NodeFlowInspector.js";
import { NodeFlowLibrary } from "./components/nodes/NodeFlowLibrary.js";
import { NodeFlowRunPanel } from "./components/nodes/NodeFlowRunPanel.js";
import { useProjectData } from "./context/project-data.js";
import {
  attachNodeFlowToAgent,
  createNodeFlow,
  deleteNodeFlow,
  detachNodeFlowFromAgent,
  fetchNodeFlowAgentSkills,
  fetchNodeFlowNodeRuns,
  fetchNodeFlowRuns,
  fetchNodeFlows,
  runNodeFlow,
  updateNodeFlow,
  validateNodeFlow,
} from "./lib/node-flow-api.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type {
  AgentPreset,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowNode,
  NodeFlowNodeRunRecord,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
} from "./types.js";
import {
  createDefaultNodeFlowGraph,
  getValidationBadgeState,
  isNodeFlowDirty,
  updateNodeInGraph,
} from "./lib/node-flow-view-models.js";

type Feedback = { tone: "success" | "error" | "info"; message: string } | null;

const panelClass = "rounded-[1.6rem] border border-black/[0.08] bg-white/65 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04]";

export const NodesPage = () => {
  const { selectedProject, loading: projectLoading } = useProjectData();
  const [flows, setFlows] = useState<NodeFlowRecord[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentPreset[]>([]);
  const [attachments, setAttachments] = useState<NodeFlowSkillAttachment[]>([]);
  const [runs, setRuns] = useState<NodeFlowRunRecord[]>([]);
  const [nodeRuns, setNodeRuns] = useState<NodeFlowNodeRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftGraph, setDraftGraph] = useState<NodeFlowGraph>(() => createDefaultNodeFlowGraph());
  const [validation, setValidation] = useState<NodeFlowValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [running, setRunning] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachAgentId, setAttachAgentId] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const selectedFlow = useMemo(() => flows.find((flow) => flow.id === selectedFlowId) ?? null, [flows, selectedFlowId]);
  const selectedNode = useMemo(() => draftGraph.nodes.find((node) => node.id === selectedNodeId) ?? draftGraph.nodes[0] ?? null, [draftGraph.nodes, selectedNodeId]);
  const dirty = isNodeFlowDirty(selectedFlow, draftTitle, draftDescription, draftGraph);
  const validationBadge = getValidationBadgeState(validation, dirty);

  const loadProjectData = useCallback(async (projectId: string, signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    setFeedback(null);
    try {
      const [flowResponse, nextAgents] = await Promise.all([
        fetchNodeFlows(projectId, signal),
        fetchAgentPresets(projectId),
      ]);
      setFlows(flowResponse.flows);
      setAgents(nextAgents);
      const nextSelected = flowResponse.flows.find((flow) => flow.id === selectedFlowId) ?? flowResponse.flows[0] ?? null;
      setSelectedFlowId(nextSelected?.id ?? null);
      if (!nextSelected) {
        setDraftTitle("");
        setDraftDescription("");
        setDraftGraph(createDefaultNodeFlowGraph());
        setSelectedNodeId(null);
        setAttachments([]);
        setRuns([]);
        setNodeRuns([]);
        setSelectedRunId(null);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to load node flows." });
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [selectedFlowId]);

  useEffect(() => {
    if (!selectedProject?.id) {
      setFlows([]);
      setSelectedFlowId(null);
      return;
    }
    const controller = new AbortController();
    void loadProjectData(selectedProject.id, controller.signal);
    return () => controller.abort();
  }, [loadProjectData, selectedProject?.id]);

  useEffect(() => {
    if (!selectedFlow) {
      return;
    }
    setDraftTitle(selectedFlow.title);
    setDraftDescription(selectedFlow.description);
    setDraftGraph(selectedFlow.graph);
    setSelectedNodeId(selectedFlow.graph.nodes[0]?.id ?? null);
    setValidation(null);
    setRunError(null);
  }, [selectedFlow?.id]);

  const refreshFlowDetails = useCallback(async (flowId: string): Promise<void> => {
    const [nextAttachments, runResponse] = await Promise.all([
      fetchNodeFlowAgentSkills(flowId),
      fetchNodeFlowRuns(flowId, 25),
    ]);
    setAttachments(nextAttachments);
    setRuns(runResponse.runs);
    setSelectedRunId((current) => current && runResponse.runs.some((run) => run.id === current)
      ? current
      : runResponse.runs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (!selectedFlowId) {
      return;
    }
    let cancelled = false;
    setLoadingRuns(true);
    refreshFlowDetails(selectedFlowId)
      .catch((error) => {
        if (!cancelled) {
          setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to load node flow runs." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRuns(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshFlowDetails, selectedFlowId]);

  useEffect(() => {
    if (!selectedRunId) {
      setNodeRuns([]);
      return;
    }
    let cancelled = false;
    fetchNodeFlowNodeRuns(selectedRunId)
      .then((response) => {
        if (!cancelled) {
          setNodeRuns(response.nodeRuns);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNodeRuns([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const handleCreateFlow = async (): Promise<void> => {
    if (!selectedProject) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const created = await createNodeFlow(selectedProject.id, {
        title: "Untitled Node Flow",
        description: "",
        graph: createDefaultNodeFlowGraph(),
      });
      setFlows((current) => [created, ...current]);
      setSelectedFlowId(created.id);
      setFeedback({ tone: "success", message: "Node flow created." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to create node flow." });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!selectedFlow) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await updateNodeFlow(selectedFlow.id, {
        title: draftTitle,
        description: draftDescription,
        graph: draftGraph,
      });
      setFlows((current) => current.map((flow) => flow.id === updated.id ? updated : flow));
      setValidation({ valid: true, errors: [], graph: updated.graph });
      setFeedback({ tone: "success", message: "Node flow saved." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to save node flow." });
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async (): Promise<void> => {
    if (!selectedFlow) {
      return;
    }
    setValidating(true);
    setFeedback(null);
    try {
      const result = await validateNodeFlow(selectedFlow.id, draftGraph);
      setValidation(result);
      setFeedback({ tone: result.valid ? "success" : "error", message: result.valid ? "Node flow is valid." : "Validation found graph issues." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to validate node flow." });
    } finally {
      setValidating(false);
    }
  };

  const handleDelete = async (flowId: string): Promise<void> => {
    setSaving(true);
    setFeedback(null);
    try {
      await deleteNodeFlow(flowId);
      setFlows((current) => current.filter((flow) => flow.id !== flowId));
      if (selectedFlowId === flowId) {
        const remaining = flows.filter((flow) => flow.id !== flowId);
        setSelectedFlowId(remaining[0]?.id ?? null);
      }
      setFeedback({ tone: "success", message: "Node flow deleted." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete node flow." });
    } finally {
      setSaving(false);
    }
  };

  const handleNodeChange = (nodeId: string, update: Partial<NodeFlowNode>): void => {
    setDraftGraph((current) => updateNodeInGraph(current, nodeId, update));
    setValidation(null);
  };

  const handleAddNode = (): void => {
    const nextIndex = draftGraph.nodes.length + 1;
    const nodeId = `node-${nextIndex}`;
    const nextNode: NodeFlowNode = {
      id: nodeId,
      type: "action",
      title: `Action ${nextIndex}`,
      description: "",
      position: { x: 80 + nextIndex * 36, y: 120 + nextIndex * 24 },
      widgetSchema: {
        fields: [
          { id: "prompt", type: "textarea", label: "Prompt", defaultValue: "" },
          { id: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
        ],
      },
      data: { prompt: "", enabled: true },
    };
    setDraftGraph((current) => ({ ...current, nodes: [...current.nodes, nextNode] }));
    setSelectedNodeId(nodeId);
    setValidation(null);
  };

  const handleAddEdge = (): void => {
    if (draftGraph.nodes.length < 2) {
      return;
    }
    const fromNode = selectedNode ?? draftGraph.nodes[0]!;
    const toNode = draftGraph.nodes.find((node) => node.id !== fromNode.id && !draftGraph.edges.some((edge) => edge.fromNodeId === fromNode.id && edge.toNodeId === node.id));
    if (!toNode) {
      setFeedback({ tone: "info", message: "All simple edges from the selected node already exist." });
      return;
    }
    setDraftGraph((current) => ({
      ...current,
      edges: [...current.edges, { id: `${fromNode.id}-${toNode.id}`, fromNodeId: fromNode.id, toNodeId: toNode.id }],
    }));
    setValidation(null);
  };

  const handleAttachAgent = async (): Promise<void> => {
    if (!selectedFlow || !attachAgentId) {
      return;
    }
    setAttaching(true);
    try {
      const attachment = await attachNodeFlowToAgent(selectedFlow.id, { agentPresetId: attachAgentId });
      setAttachments((current) => [...current.filter((entry) => entry.agentPresetId !== attachment.agentPresetId), attachment]);
      setAttachAgentId("");
      setFeedback({ tone: "success", message: "Agent attached." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to attach agent." });
    } finally {
      setAttaching(false);
    }
  };

  const handleDetachAgent = async (agentPresetId: string): Promise<void> => {
    if (!selectedFlow) {
      return;
    }
    try {
      await detachNodeFlowFromAgent(selectedFlow.id, agentPresetId);
      setAttachments((current) => current.filter((entry) => entry.agentPresetId !== agentPresetId));
      setFeedback({ tone: "success", message: "Agent detached." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to detach agent." });
    }
  };

  const handleRun = async (input: NodeFlowJsonObject): Promise<void> => {
    if (!selectedFlow) {
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const run = await runNodeFlow(selectedFlow.id, { input });
      setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
      setSelectedRunId(run.id);
      setFeedback({ tone: "success", message: "Node flow run queued." });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to run node flow.");
    } finally {
      setRunning(false);
    }
  };

  const refreshRuns = async (): Promise<void> => {
    if (!selectedFlow) {
      return;
    }
    setLoadingRuns(true);
    try {
      const response = await fetchNodeFlowRuns(selectedFlow.id, 25);
      setRuns(response.runs);
      setSelectedRunId((current) => current && response.runs.some((run) => run.id === current)
        ? current
        : response.runs[0]?.id ?? null);
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to refresh runs." });
    } finally {
      setLoadingRuns(false);
    }
  };

  if (projectLoading || !selectedProject) {
    return (
      <PageContainer aria-label="Nodes" padding="standard" className="gap-8">
        {!selectedProject ? <ProjectPlaceholder /> : (
          <div role="status" className={panelClass}>Loading project node flows…</div>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer aria-label="Nodes" padding="standard" className="gap-8" data-testid="nodes-page-root">
      <PageHeader
        data-testid="nodes-primary-header"
        icon={GitBranch}
        eyebrow="Nodes"
        title="Workflow Nodes"
        subtitle="Project workflow graphs, agent attachments, validation, and manual runs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={validationBadge.title}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-[0.13em] ${
                validationBadge.tone === "success" ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                  : validationBadge.tone === "danger" ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
                  : validationBadge.tone === "warning" ? "border-ember-500/25 bg-ember-500/[0.08] text-ember-700 dark:text-ember-300"
                  : "border-black/[0.08] bg-white/60 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400"
              }`}
            >
              {validationBadge.label}
            </span>
            <button
              type="button"
              onClick={handleValidate}
              disabled={!selectedFlow || validating}
              className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/70 px-4 py-2 text-sm font-bold text-slate-600 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Validate
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!selectedFlow || !dirty || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-void-900"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save
            </button>
          </div>
        }
      />

      {feedback ? (
        <div
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedback.tone === "error"
              ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
              : "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <NodeFlowLibrary
          flows={flows}
          selectedFlowId={selectedFlowId}
          loading={loading}
          onSelect={setSelectedFlowId}
          onCreate={() => void handleCreateFlow()}
          onDelete={(flowId) => void handleDelete(flowId)}
        />

        {selectedFlow ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <section className={panelClass} aria-label="Flow settings">
              <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Flow title
                  <input
                    className="w-full rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 text-sm normal-case tracking-normal text-slate-800 outline-none focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100"
                    value={draftTitle}
                    onInput={(event) => setDraftTitle(event.currentTarget.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Description
                  <input
                    className="w-full rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 text-sm normal-case tracking-normal text-slate-800 outline-none focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100"
                    value={draftDescription}
                    onInput={(event) => setDraftDescription(event.currentTarget.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddNode}
                  className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-xs font-bold text-slate-600 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Node
                </button>
                <button
                  type="button"
                  onClick={handleAddEdge}
                  disabled={draftGraph.nodes.length < 2}
                  className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-xs font-bold text-slate-600 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
                >
                  <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Edge
                </button>
              </div>
            </section>

            {validation && !validation.valid ? (
              <section role="alert" className="rounded-2xl border border-status-red/25 bg-status-red/[0.08] px-4 py-3 text-sm text-status-red">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Validation issues
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {validation.errors.map((error) => (
                    <li key={`${error.field}-${error.code}-${error.message}`}>
                      <span className="font-mono text-xs">{error.field}</span>: {error.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
              <div className="min-w-0 flex-1">
                <NodeFlowCanvas
                  graph={draftGraph}
                  selectedNodeId={selectedNode?.id ?? null}
                  onSelectNode={setSelectedNodeId}
                  onMoveNode={(nodeId, position) => handleNodeChange(nodeId, { position })}
                />
              </div>
              <NodeFlowInspector
                selectedNode={selectedNode}
                validation={validation}
                agents={agents}
                attachments={attachments}
                attachAgentId={attachAgentId}
                attaching={attaching}
                onAttachAgentIdChange={setAttachAgentId}
                onAttachAgent={() => void handleAttachAgent()}
                onDetachAgent={(agentPresetId) => void handleDetachAgent(agentPresetId)}
                onNodeChange={handleNodeChange}
              />
            </div>

            <NodeFlowRunPanel
              graph={draftGraph}
              runs={runs}
              nodeRuns={nodeRuns}
              selectedRunId={selectedRunId}
              running={running}
              loadingRuns={loadingRuns}
              runError={runError}
              onRun={(input) => void handleRun(input)}
              onRefreshRuns={() => void refreshRuns()}
              onSelectRun={setSelectedRunId}
            />
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-black/[0.08] bg-white/45 px-8 py-16 text-center backdrop-blur-2xl dark:border-white/[0.08] dark:bg-white/[0.03]">
            <Workflow className="h-12 w-12 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">No Node Flows</h2>
            <p className="max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">Create a project workflow graph to configure nodes and attach it to agents.</p>
            <button
              type="button"
              onClick={() => void handleCreateFlow()}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-void-900"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Node Flow
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
};

const ProjectPlaceholder = () => (
  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed border-black/[0.08] bg-white/40 px-8 py-16 text-center backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/40">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5 dark:bg-signal-500/15 dark:text-signal-400 dark:ring-white/[0.06]">
      <GitBranch className="h-8 w-8 text-signal-600 dark:text-signal-400" strokeWidth={1.4} aria-hidden="true" />
    </div>
    <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Select a project to edit node workflows.</h1>
    <p className="max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">Node flows are project-scoped so runs and agent attachments stay tied to the right workspace.</p>
  </div>
);
