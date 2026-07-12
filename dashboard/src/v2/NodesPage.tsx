import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, Plus, Save, Workflow } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { Button } from "./components/ui/Button.js";
import { NodeFlowLibrary } from "./components/nodes/NodeFlowLibrary.js";
import { NodeFlowCanvas } from "./components/nodes/NodeFlowCanvas.js";
import { NodeFlowInspector } from "./components/nodes/NodeFlowInspector.js";
import { NodePalette } from "./components/nodes/NodePalette.js";
import { NodeGovernancePanel } from "./components/nodes/NodeGovernancePanel.js";
import { NodeRunDebugger } from "./components/nodes/NodeRunDebugger.js";
import { useProjectData } from "./context/project-data.js";
import type { AutomationApprovalRecord, NodeDefinitionManifest, NodeFlowDraftReview, NodeFlowGraph, NodeFlowNode, NodeFlowNodeAttemptRecord, NodeFlowNodeRunRecord, NodeFlowRecord, NodeFlowRunRecord } from "./types.js";
import { createDefaultNodeFlowGraph, isNodeFlowDirty, updateNodeInGraph } from "./lib/node-flow-view-models.js";
import { deserializeNodeCanvasGraphWithMigration, toCanonicalNodeFlowGraph } from "./lib/nodes-canvas-state.js";
import {
  cancelNodeFlowRun, compareNodeFlowVersions, createNodeFlowDraft, decideNodeFlowApproval, deleteNodeFlow, dryRunNodeFlowDraft,
  fetchNodeDefinition, fetchNodeFlow, fetchNodeFlowApprovals, fetchNodeFlowAttempts, fetchNodeFlowCatalog, fetchNodeFlowNodeRuns,
  fetchNodeFlowRuns, fetchNodeFlows, patchNodeFlowDraft, publishNodeFlowDraft, requestNodeFlowCredential,
  retryNodeFlowRun, rollbackNodeFlow, runNodeFlow, validateNodeFlowDraft,
  type NodeDefinitionSummary, type NodeFlowDryRunResponse, type NodeFlowVersionDiff,
} from "./lib/node-flow-api.js";

export const NODES_CANVAS_STORAGE_KEY = "codeux:nodes-canvas:v1";
const migrationMarker = (projectId: string): string => `codeux:nodes-canvas:imported:${projectId}`;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "The node-flow request failed.";

export const NodesPage: FunctionComponent = () => {
  const { selectedProject, loading: projectLoading } = useProjectData();
  const projectId = selectedProject?.id ?? null;
  const projectRef = useRef(projectId); projectRef.current = projectId;
  const [flows, setFlows] = useState<NodeFlowRecord[]>([]);
  const [catalog, setCatalog] = useState<NodeDefinitionSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [record, setRecord] = useState<NodeFlowRecord | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [graph, setGraph] = useState<NodeFlowGraph>(createDefaultNodeFlowGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, NodeDefinitionManifest>>({});
  const [review, setReview] = useState<NodeFlowDraftReview | null>(null);
  const [dryRun, setDryRun] = useState<NodeFlowDryRunResponse | null>(null);
  const [diff, setDiff] = useState<NodeFlowVersionDiff | null>(null);
  const [runs, setRuns] = useState<NodeFlowRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [nodeRuns, setNodeRuns] = useState<NodeFlowNodeRunRecord[]>([]);
  const [attempts, setAttempts] = useState<NodeFlowNodeAttemptRecord[]>([]);
  const [approvals, setApprovals] = useState<AutomationApprovalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedNode = useMemo(() => graph.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId]);
  const selectedDefinition = selectedNode?.definition ? definitions[`${selectedNode.definition.type}@${selectedNode.definition.version}`] ?? null : null;
  const dirty = isNodeFlowDirty(record, title, description, graph);

  const applyRecord = useCallback((flow: NodeFlowRecord): void => {
    setRecord(flow); setSelectedFlowId(flow.id); setTitle(flow.title); setDescription(flow.description); setGraph(flow.graph);
    setSelectedNodeId(flow.graph.nodes[0]?.id ?? null); setReview(null); setDryRun(null); setDiff(null);
  }, []);

  const loadLibrary = useCallback(async (nextProjectId: string, signal?: AbortSignal): Promise<void> => {
    setLoading(true); setError(null);
    try {
      const [library, registry] = await Promise.all([fetchNodeFlows(nextProjectId, signal), fetchNodeFlowCatalog(signal)]);
      if (projectRef.current !== nextProjectId) return;
      let nextFlows = library.flows;
      const legacy = typeof window !== "undefined" ? window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY) : null;
      if (legacy && !window.localStorage.getItem(migrationMarker(nextProjectId))) {
        const importedGraph = toCanonicalNodeFlowGraph(deserializeNodeCanvasGraphWithMigration(legacy).graph);
        const imported = await createNodeFlowDraft(nextProjectId, { title: "Imported Nodes Canvas", description: "One-time import from the legacy browser canvas.", graph: importedGraph });
        window.localStorage.setItem(migrationMarker(nextProjectId), imported.flowId);
        window.localStorage.removeItem(NODES_CANVAS_STORAGE_KEY);
        nextFlows = (await fetchNodeFlows(nextProjectId, signal)).flows;
        setNotice("Legacy canvas imported once into this project's backend flow library.");
      }
      setCatalog(registry.nodes); setFlows(nextFlows);
      const preferred = nextFlows.find((flow) => flow.id === selectedFlowId) ?? nextFlows[0] ?? null;
      if (preferred) {
        applyRecord(preferred);
        setReview(await validateNodeFlowDraft(nextProjectId, preferred.id));
      } else { setRecord(null); setSelectedFlowId(null); setReview(null); }
    } catch (requestError) { if (!signal?.aborted) setError(errorMessage(requestError)); }
    finally { if (!signal?.aborted && projectRef.current === nextProjectId) setLoading(false); }
  }, [applyRecord, selectedFlowId]);

  useEffect(() => {
    setFlows([]); setRecord(null); setSelectedFlowId(null); setRuns([]); setError(null); setNotice(null);
    if (!projectId) return;
    const controller = new AbortController(); void loadLibrary(projectId, controller.signal); return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!selectedNode?.definition) return;
    const key = `${selectedNode.definition.type}@${selectedNode.definition.version}`;
    if (definitions[key]) return;
    void fetchNodeDefinition(selectedNode.definition.type, selectedNode.definition.version).then((definition) => setDefinitions((current) => ({ ...current, [key]: definition }))).catch((requestError) => setError(errorMessage(requestError)));
  }, [selectedNode?.definition?.type, selectedNode?.definition?.version]);

  const refreshRuns = useCallback(async (): Promise<void> => {
    if (!record) return;
    const response = await fetchNodeFlowRuns(record.id); setRuns(response.runs); setSelectedRunId((current) => current ?? response.runs[0]?.id ?? null);
  }, [record]);
  useEffect(() => { setRuns([]); setSelectedRunId(null); if (record) void refreshRuns().catch((requestError) => setError(errorMessage(requestError))); }, [record?.id]);
  useEffect(() => { if (!selectedRunId) { setNodeRuns([]); setAttempts([]); setApprovals([]); return; } const controller = new AbortController(); void Promise.all([fetchNodeFlowNodeRuns(selectedRunId, controller.signal), fetchNodeFlowAttempts(selectedRunId, controller.signal), fetchNodeFlowApprovals(selectedRunId, controller.signal)]).then(([nodes, history, governed]) => { setNodeRuns(nodes.nodeRuns); setAttempts(history.attempts); setApprovals(governed.approvals); }).catch((requestError) => { if (!controller.signal.aborted) setError(errorMessage(requestError)); }); return () => controller.abort(); }, [selectedRunId]);

  const act = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setError(null); setNotice(null); try { await action(); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  const selectFlow = (flowId: string): void => { const flow = flows.find((item) => item.id === flowId); if (!flow || !projectId) return; applyRecord(flow); void validateNodeFlowDraft(projectId, flow.id).then(setReview).catch((requestError) => setError(errorMessage(requestError))); };
  const createFlow = (): void => { if (!projectId) return; void act(async () => { const created = await createNodeFlowDraft(projectId, { title: "Untitled automation", description: "", graph: createDefaultNodeFlowGraph() }); const flow = await fetchNodeFlow(created.flowId); setFlows((current) => [flow, ...current]); applyRecord(flow); setReview(created); setNotice("Draft created in the selected project."); }); };
  const save = (): void => { if (!projectId || !record) return; void act(async () => { const result = await patchNodeFlowDraft(record.id, { projectId, draftRevision: record.version, title, description, graph }); if (result.conflict) { setError(`${result.conflict.message} Current revision is ${result.conflict.actualDraftRevision}.`); return; } const saved = await fetchNodeFlow(record.id); setFlows((current) => current.map((item) => item.id === saved.id ? saved : item)); applyRecord(saved); setReview(result.draft ?? null); setNotice("Draft saved to the canonical flow repository."); }); };
  const addNode = (summary: NodeDefinitionSummary): void => { void act(async () => { const definition = await fetchNodeDefinition(summary.type, summary.version); setDefinitions((current) => ({ ...current, [`${definition.type}@${definition.version}`]: definition })); let suffix = 1; while (graph.nodes.some((node) => node.id === `${definition.type}-${suffix}`)) suffix += 1; const node: NodeFlowNode = { id: `${definition.type}-${suffix}`, type: definition.type, title: definition.ui.label, description: definition.ui.description, definition: { type: definition.type, version: definition.version }, ports: definition.ports, widgetSchema: definition.ui.widgetSchema, data: {}, capabilities: definition.capabilities, sideEffect: definition.sideEffect, policy: definition.defaultPolicy, credentialBindings: [], position: { x: 80 + graph.nodes.length * 260, y: 100 } }; setGraph((current) => ({ ...current, nodes: [...current.nodes, node] })); setSelectedNodeId(node.id); }); };
  const validate = (): void => { if (!projectId || !record) return; void act(async () => setReview(await validateNodeFlowDraft(projectId, record.id))); };
  const runDry = (): void => { if (!projectId || !record) return; void act(async () => setDryRun(await dryRunNodeFlowDraft(projectId, record.id))); };
  const publish = (): void => { if (!projectId || !record || !review) return; void act(async () => { setReview(await publishNodeFlowDraft(projectId, record.id, review.draftRevision)); setNotice("Draft published after governed review."); }); };
  const compare = (): void => { if (!projectId || !record || !review?.publishedVersion) return; const publishedVersion = review.publishedVersion; void act(async () => setDiff(await compareNodeFlowVersions(projectId, record.id, publishedVersion, record.version))); };
  const rollback = (): void => { if (!projectId || !record || !review?.publishedVersion) return; void act(async () => { const next = await rollbackNodeFlow(projectId, record.id, review.publishedVersion!, record.version); const flow = await fetchNodeFlow(record.id); applyRecord(flow); setReview(next); }); };
  const run = (): void => { if (!projectId || !record) return; void act(async () => { const result = await runNodeFlow(record.id, { projectId, input: {} }); setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); }); };

  if (projectLoading) return <PageContainer><div role="status" className="p-10 text-sm text-slate-500">Loading project workspace…</div></PageContainer>;
  if (!selectedProject) return <PageContainer><PageHeader icon={Workflow} eyebrow="Nodes" title="Automation workspace" subtitle="Select a project to load its governed node-flow library." /><EmptyState icon={<Workflow className="h-7 w-7" />} title="Select a project" description="Flows, credentials, publications, and run history are always scoped to a project." /></PageContainer>;
  return <PageContainer className="gap-5" padding="workbench" aria-labelledby="nodes-workspace-title">
    <PageHeader icon={Workflow} eyebrow={selectedProject.name} title={<span id="nodes-workspace-title">Automation workspace</span>} subtitle="Build from the governed registry, review policy and permissions, publish immutable versions, and debug redacted runs." actions={<><Button size="sm" icon={Plus} onClick={createFlow} disabled={busy}>New draft</Button><Button size="sm" variant="secondary" icon={Save} onClick={save} disabled={busy || !record || !dirty}>Save draft</Button><Button size="sm" variant="secondary" onClick={run} disabled={busy || !record || !review?.publishedVersion}>Run published</Button></>} />
    {error ? <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.07] p-3 text-sm text-status-red"><AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}<button type="button" className="ml-3 underline" onClick={() => void loadLibrary(selectedProject.id)}>Retry</button></div> : null}
    {notice ? <div role="status" className="rounded-xl border border-status-green/20 bg-status-green/[0.06] p-3 text-sm text-slate-700 dark:text-slate-200">{notice}</div> : null}
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row"><NodeFlowLibrary flows={flows} selectedFlowId={selectedFlowId} loading={loading} onSelect={selectFlow} onCreate={createFlow} onDelete={(id) => void act(async () => { await deleteNodeFlow(id); await loadLibrary(selectedProject.id); })} />
      <div className="min-w-0 flex-1">{record ? <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold uppercase text-slate-500">Flow name<input className="mt-1 w-full rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-sm normal-case dark:border-white/[0.08] dark:bg-white/[0.04]" value={title} onInput={(event) => setTitle(event.currentTarget.value)} /></label><label className="text-xs font-bold uppercase text-slate-500">Description<input className="mt-1 w-full rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-sm normal-case dark:border-white/[0.08] dark:bg-white/[0.04]" value={description} onInput={(event) => setDescription(event.currentTarget.value)} /></label></div> : null}{record ? <NodeFlowCanvas graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onMoveNode={(id, position) => setGraph((current) => updateNodeInGraph(current, id, { position }))} /> : <EmptyState icon={<Workflow className="h-7 w-7" />} title="No flows in this project" description="Create a draft to start from the canonical backend workspace." primaryAction={<Button onClick={createFlow}>Create draft</Button>} />}</div>
      <NodePalette definitions={catalog} loading={loading} disabled={!record || busy} onCreateNode={addNode} />
      {record ? <NodeFlowInspector selectedNode={selectedNode} definition={selectedDefinition} validation={review ? { valid: review.valid, errors: review.validationIssues } : null} requiredCredentials={review?.requiredCredentials.filter((item) => item.nodeId === selectedNode?.id) ?? []} agents={[]} attachments={[]} attachAgentId="" onAttachAgentIdChange={() => undefined} onAttachAgent={() => undefined} onDetachAgent={() => undefined} onNodeChange={(id, update) => setGraph((current) => updateNodeInGraph(current, id, update))} onRequestCredential={(nodeId, slot) => { if (projectId && record) void act(async () => { await requestNodeFlowCredential(projectId, record.id, nodeId, slot); setNotice("Credential binding request recorded; secret material remains outside the graph."); }); }} /> : null}
    </div>
    {record ? <><NodeGovernancePanel review={review} dryRun={dryRun} diff={diff} busy={busy} onValidate={validate} onDryRun={runDry} onCompare={compare} onPublish={publish} onRollback={rollback} /><NodeRunDebugger runs={runs} selectedRunId={selectedRunId} nodeRuns={nodeRuns} attempts={attempts} approvals={approvals} busy={busy} onSelectRun={setSelectedRunId} onRefresh={() => void act(refreshRuns)} onCancel={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { await cancelNodeFlowRun(projectId, active.id); await refreshRuns(); }); }} onRetry={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { const result = await retryNodeFlowRun(projectId, active.id); setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); }); }} onApprovalDecision={(approvalId, decision) => void act(async () => { const result = await decideNodeFlowApproval(approvalId, decision); setRuns((current) => current.map((item) => item.id === result.run.id ? result.run : item)); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); setApprovals((current) => current.map((item) => item.id === approvalId ? { ...item, status: result.status, decidedAt: result.decidedAt, decidedBy: result.decidedBy, decision: result.decision, updatedAt: result.updatedAt } : item)); })} /></> : null}
  </PageContainer>;
};
