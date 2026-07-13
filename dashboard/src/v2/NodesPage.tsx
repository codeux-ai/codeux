import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, Plus, Save, Workflow } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { Button } from "./components/ui/Button.js";
import { NodeFlowLibrary } from "./components/nodes/NodeFlowLibrary.js";
import { NodeFlowCanvas } from "./components/nodes/NodeFlowCanvas.js";
import { NodeFlowInspector, type CredentialBindingFeedback } from "./components/nodes/NodeFlowInspector.js";
import type { CredentialSelectionResult } from "./components/nodes/NodeCredentialPicker.js";
import { NodePalette } from "./components/nodes/NodePalette.js";
import { NodeGovernancePanel } from "./components/nodes/NodeGovernancePanel.js";
import { NodeRunDebugger } from "./components/nodes/NodeRunDebugger.js";
import { useProjectData } from "./context/project-data.js";
import type { AgentPreset, AutomationApprovalRecord, NodeDefinitionManifest, NodeFlowDraftReview, NodeFlowGraph, NodeFlowNode, NodeFlowNodeAttemptRecord, NodeFlowNodeRunRecord, NodeFlowRecord, NodeFlowRunRecord, NodeFlowSkillAttachment } from "./types.js";
import { createDefaultNodeFlowGraph, isNodeFlowDirty, updateNodeInGraph } from "./lib/node-flow-view-models.js";
import { deserializeNodeCanvasGraphWithMigration, toCanonicalNodeFlowGraph } from "./lib/nodes-canvas-state.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import {
  attachNodeFlowToAgent, cancelNodeFlowRun, compareNodeFlowVersions, createNodeFlowDraft, decideNodeFlowApproval, deleteNodeFlow, detachNodeFlowFromAgent, dryRunNodeFlowDraft,
  fetchNodeDefinition, fetchNodeFlow, fetchNodeFlowApprovals, fetchNodeFlowAttempts, fetchNodeFlowCatalog, fetchNodeFlowNodeRuns,
  fetchNodeFlowAgentSkills, fetchNodeFlowRuns, fetchNodeFlows, patchNodeFlowDraft, publishNodeFlowDraft,
  retryNodeFlowRun, rollbackNodeFlow, runNodeFlow, validateNodeFlowDraft,
  NodeFlowDraftSaveError, type NodeDefinitionSummary, type NodeFlowDryRunResponse, type NodeFlowVersionDiff,
} from "./lib/node-flow-api.js";

export const NODES_CANVAS_STORAGE_KEY = "codeux:nodes-canvas:v1";
const migrationMarker = (projectId: string): string => `codeux:nodes-canvas:imported:${projectId}`;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "The node-flow request failed.";

export const NodesPage: FunctionComponent = () => {
  const { selectedProject, loading: projectLoading } = useProjectData();
  const projectId = selectedProject?.id ?? null;
  const projectRef = useRef(projectId); projectRef.current = projectId;
  const flowRef = useRef<string | null>(null);
  const selectedFlowRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const reviewRequestRef = useRef(0);
  const credentialMutationRequestRef = useRef(0);
  const mountedRef = useRef(true);
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
  const [agents, setAgents] = useState<AgentPreset[]>([]);
  const [attachments, setAttachments] = useState<NodeFlowSkillAttachment[]>([]);
  const [attachAgentId, setAttachAgentId] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [flowAttachmentError, setFlowAttachmentError] = useState<string | null>(null);
  const [attachmentMutationError, setAttachmentMutationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationWarning, setMigrationWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialFeedback, setCredentialFeedback] = useState<CredentialBindingFeedback | null>(null);

  const selectedNode = useMemo(() => graph.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId]);
  const selectedDefinition = selectedNode?.definition ? definitions[`${selectedNode.definition.type}@${selectedNode.definition.version}`] ?? null : null;
  const dirty = isNodeFlowDirty(record, title, description, graph);
  flowRef.current = record?.id ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; reviewRequestRef.current += 1; credentialMutationRequestRef.current += 1; };
  }, []);

  const applyRecord = useCallback((flow: NodeFlowRecord): void => {
    flowRef.current = flow.id; selectedFlowRef.current = flow.id;
    setRecord(flow); setSelectedFlowId(flow.id); setTitle(flow.title); setDescription(flow.description); setGraph(flow.graph);
    selectedNodeRef.current = flow.graph.nodes[0]?.id ?? null; setSelectedNodeId(selectedNodeRef.current); setReview(null); setDryRun(null); setDiff(null);
  }, []);

  const loadReview = useCallback(async (nextProjectId: string, flowId: string, signal?: AbortSignal): Promise<void> => {
    const requestId = ++reviewRequestRef.current;
    try {
      const nextReview = await validateNodeFlowDraft(nextProjectId, flowId, signal);
      if (signal?.aborted || projectRef.current !== nextProjectId || selectedFlowRef.current !== flowId || reviewRequestRef.current !== requestId) return;
      setReview(nextReview);
    } catch (requestError) {
      if (!signal?.aborted && projectRef.current === nextProjectId && selectedFlowRef.current === flowId && reviewRequestRef.current === requestId) {
        setError(errorMessage(requestError));
      }
    }
  }, []);

  const loadLibrary = useCallback(async (nextProjectId: string, signal?: AbortSignal): Promise<void> => {
    setLoading(true); setError(null); setMigrationWarning(null);
    try {
      const [library, registry] = await Promise.all([fetchNodeFlows(nextProjectId, signal), fetchNodeFlowCatalog(signal)]);
      if (projectRef.current !== nextProjectId) return;
      let nextFlows = library.flows;
      const legacy = typeof window !== "undefined" ? window.localStorage.getItem(NODES_CANVAS_STORAGE_KEY) : null;
      if (legacy && !window.localStorage.getItem(migrationMarker(nextProjectId))) {
        try {
          const importedGraph = toCanonicalNodeFlowGraph(deserializeNodeCanvasGraphWithMigration(legacy).graph);
          const imported = await createNodeFlowDraft(nextProjectId, { title: "Imported Nodes Canvas", description: "One-time import from the legacy browser canvas.", graph: importedGraph });
          if (projectRef.current !== nextProjectId) return;
          window.localStorage.setItem(migrationMarker(nextProjectId), imported.flowId);
          window.localStorage.removeItem(NODES_CANVAS_STORAGE_KEY);
          nextFlows = (await fetchNodeFlows(nextProjectId, signal)).flows;
          setNotice("Legacy canvas imported once into this project's backend flow library.");
        } catch (migrationError) {
          if (!signal?.aborted && projectRef.current === nextProjectId) {
            setMigrationWarning(`The legacy browser canvas could not be imported. Existing backend flows remain available. ${errorMessage(migrationError)}`);
          }
        }
      }
      setCatalog(registry.nodes); setFlows(nextFlows);
      const preferred = nextFlows.find((flow) => flow.id === selectedFlowRef.current) ?? nextFlows[0] ?? null;
      if (preferred) {
        applyRecord(preferred);
        await loadReview(nextProjectId, preferred.id, signal);
      } else { flowRef.current = null; selectedFlowRef.current = null; setRecord(null); setSelectedFlowId(null); setReview(null); }
    } catch (requestError) { if (!signal?.aborted) setError(errorMessage(requestError)); }
    finally { if (!signal?.aborted && projectRef.current === nextProjectId) setLoading(false); }
  }, [applyRecord, loadReview]);

  useEffect(() => {
    flowRef.current = null; selectedFlowRef.current = null; selectedNodeRef.current = null; reviewRequestRef.current += 1; credentialMutationRequestRef.current += 1;
    setFlows([]); setRecord(null); setSelectedFlowId(null); setRuns([]); setAgents([]); setAttachments([]); setAttachAgentId(""); setAgentsError(null); setFlowAttachmentError(null); setAttachmentMutationError(null); setAttachmentBusy(false); setError(null); setMigrationWarning(null); setNotice(null);
    setCredentialFeedback(null);
    if (!projectId) return;
    const controller = new AbortController(); void loadLibrary(projectId, controller.signal); return () => controller.abort();
  }, [projectId, loadLibrary]);

  const loadAgents = useCallback(async (nextProjectId: string, signal?: AbortSignal): Promise<void> => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const nextAgents = await fetchAgentPresets(nextProjectId, signal);
      if (projectRef.current !== nextProjectId) return;
      setAgents(nextAgents);
      setAttachAgentId((current) => nextAgents.some((agent) => agent.id === current) ? current : "");
    } catch (requestError) {
      if (!signal?.aborted && projectRef.current === nextProjectId) setAgentsError(`Could not load project agents: ${errorMessage(requestError)}`);
    } finally {
      if (!signal?.aborted && projectRef.current === nextProjectId) setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    setAgents([]); setAttachAgentId(""); setAgentsLoading(false);
    if (!projectId) return;
    const controller = new AbortController(); void loadAgents(projectId, controller.signal); return () => controller.abort();
  }, [projectId, loadAgents]);

  const loadAttachments = useCallback(async (flowId: string, signal?: AbortSignal): Promise<void> => {
    setAttachmentsLoading(true);
    setFlowAttachmentError(null);
    try {
      const nextAttachments = await fetchNodeFlowAgentSkills(flowId, signal);
      if (flowRef.current !== flowId) return;
      setAttachments(nextAttachments);
    } catch (requestError) {
      if (!signal?.aborted && flowRef.current === flowId) setFlowAttachmentError(`Could not load flow attachments: ${errorMessage(requestError)}`);
    } finally {
      if (!signal?.aborted && flowRef.current === flowId) setAttachmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    setAttachments([]); setAttachAgentId(""); setAttachmentsLoading(false); setAttachmentBusy(false); setFlowAttachmentError(null); setAttachmentMutationError(null);
    if (!record) return;
    const controller = new AbortController(); void loadAttachments(record.id, controller.signal); return () => controller.abort();
  }, [record?.id, loadAttachments]);

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

  const act = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setError(null); setNotice(null); try { await action(); } catch (requestError) { if (mountedRef.current) setError(errorMessage(requestError)); } finally { if (mountedRef.current) setBusy(false); } };
  const editTitle = (value: string): void => { credentialMutationRequestRef.current += 1; setCredentialFeedback(null); setTitle(value); };
  const editDescription = (value: string): void => { credentialMutationRequestRef.current += 1; setCredentialFeedback(null); setDescription(value); };
  const editGraph = (update: (current: NodeFlowGraph) => NodeFlowGraph): void => { credentialMutationRequestRef.current += 1; setCredentialFeedback(null); setGraph(update); };
  const refreshAttachmentData = (): void => {
    setAttachmentMutationError(null);
    if (projectId) void loadAgents(projectId);
    if (record) void loadAttachments(record.id);
  };
  const attachAgent = (): void => {
    if (!projectId || !record || !attachAgentId || attachmentBusy) return;
    const mutationProjectId = projectId;
    const flowId = record.id;
    const agentPresetId = attachAgentId;
    setAttachmentBusy(true); setAttachmentMutationError(null);
    void attachNodeFlowToAgent(flowId, { agentPresetId }).then(async () => {
      const nextAttachments = await fetchNodeFlowAgentSkills(flowId);
      if (projectRef.current !== mutationProjectId || flowRef.current !== flowId) return;
      setAttachments(nextAttachments); setAttachAgentId("");
    }).catch((requestError) => {
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentMutationError(`Could not attach agent: ${errorMessage(requestError)}`);
    }).finally(() => {
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentBusy(false);
    });
  };
  const detachAgent = (agentPresetId: string): void => {
    if (!projectId || !record || attachmentBusy) return;
    const mutationProjectId = projectId;
    const flowId = record.id;
    setAttachmentBusy(true); setAttachmentMutationError(null);
    void detachNodeFlowFromAgent(flowId, agentPresetId).then(async () => {
      const nextAttachments = await fetchNodeFlowAgentSkills(flowId);
      if (projectRef.current !== mutationProjectId || flowRef.current !== flowId) return;
      setAttachments(nextAttachments);
    }).catch((requestError) => {
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentMutationError(`Could not detach agent: ${errorMessage(requestError)}`);
    }).finally(() => {
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentBusy(false);
    });
  };
  const selectFlow = (flowId: string): void => { const flow = flows.find((item) => item.id === flowId); if (!flow || !projectId) return; credentialMutationRequestRef.current += 1; setCredentialFeedback(null); applyRecord(flow); void loadReview(projectId, flow.id); };
  const createFlow = (): void => { if (!projectId) return; const targetProjectId = projectId; void act(async () => { const created = await createNodeFlowDraft(targetProjectId, { title: "Untitled automation", description: "", graph: createDefaultNodeFlowGraph() }); if (projectRef.current !== targetProjectId) return; const flow = await fetchNodeFlow(created.flowId); if (projectRef.current !== targetProjectId || !mountedRef.current) return; setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]); applyRecord(flow); setReview(created); setNotice("Draft created in the selected project."); }); };
  const save = (): void => { if (!projectId || !record) return; void act(async () => { const result = await patchNodeFlowDraft(record.id, { projectId, draftRevision: record.version, title, description, graph }); if (result.conflict) { setError(`${result.conflict.message} Current revision is ${result.conflict.actualDraftRevision}.`); return; } const saved = await fetchNodeFlow(record.id); setFlows((current) => current.map((item) => item.id === saved.id ? saved : item)); applyRecord(saved); setReview(result.draft ?? null); setNotice("Draft saved to the canonical flow repository."); }); };
  const addNode = (summary: NodeDefinitionSummary): void => { void act(async () => { const definition = await fetchNodeDefinition(summary.type, summary.version); setDefinitions((current) => ({ ...current, [`${definition.type}@${definition.version}`]: definition })); let suffix = 1; while (graph.nodes.some((node) => node.id === `${definition.type}-${suffix}`)) suffix += 1; const node: NodeFlowNode = { id: `${definition.type}-${suffix}`, type: definition.type, title: definition.ui.label, description: definition.ui.description, definition: { type: definition.type, version: definition.version }, ports: definition.ports, widgetSchema: definition.ui.widgetSchema, data: {}, capabilities: definition.capabilities, sideEffect: definition.sideEffect, policy: definition.defaultPolicy, credentialBindings: [], position: { x: 80 + graph.nodes.length * 260, y: 100 } }; setGraph((current) => ({ ...current, nodes: [...current.nodes, node] })); selectedNodeRef.current = node.id; credentialMutationRequestRef.current += 1; setCredentialFeedback(null); setSelectedNodeId(node.id); }); };
  const validate = (): void => { if (!projectId || !record) return; void act(async () => setReview(await validateNodeFlowDraft(projectId, record.id))); };
  const runDry = (): void => { if (!projectId || !record) return; void act(async () => setDryRun(await dryRunNodeFlowDraft(projectId, record.id))); };
  const publish = (): void => { if (!projectId || !record || !review) return; void act(async () => { setReview(await publishNodeFlowDraft(projectId, record.id, review.draftRevision)); setNotice("Draft published after governed review."); }); };
  const compare = (): void => { if (!projectId || !record || !review?.publishedVersion) return; const publishedVersion = review.publishedVersion; void act(async () => setDiff(await compareNodeFlowVersions(projectId, record.id, publishedVersion, record.version))); };
  const rollback = (): void => { if (!projectId || !record || !review?.publishedVersion) return; void act(async () => { const next = await rollbackNodeFlow(projectId, record.id, review.publishedVersion!, record.version); const flow = await fetchNodeFlow(record.id); applyRecord(flow); setReview(next); }); };
  const run = (): void => { if (!projectId || !record) return; void act(async () => { const result = await runNodeFlow(record.id, { projectId, input: {} }); setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); }); };
  const selectNode = (nodeId: string | null): void => {
    selectedNodeRef.current = nodeId;
    credentialMutationRequestRef.current += 1;
    setCredentialFeedback(null);
    setSelectedNodeId(nodeId);
  };
  const applyCredentialRecord = (saved: NodeFlowRecord, nextReview: NodeFlowDraftReview, nodeId: string): void => {
    flowRef.current = saved.id; selectedFlowRef.current = saved.id;
    setFlows((current) => current.map((item) => item.id === saved.id ? saved : item));
    setRecord(saved); setSelectedFlowId(saved.id); setTitle(saved.title); setDescription(saved.description); setGraph(saved.graph);
    const nextSelectedNodeId = saved.graph.nodes.some((node) => node.id === nodeId) ? nodeId : null;
    selectedNodeRef.current = nextSelectedNodeId; setSelectedNodeId(nextSelectedNodeId); setReview(nextReview); setDryRun(null); setDiff(null);
  };
  const changeCredential = async (nodeId: string, slot: string, credentialId: string | null): Promise<CredentialSelectionResult> => {
    if (!projectId || !record || selectedNodeRef.current !== nodeId) return "stale";
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return "stale";
    const currentCredentialId = node.credentialBindings?.find((binding) => binding.slot === slot)?.credentialId ?? null;
    if (currentCredentialId === credentialId) {
      setCredentialFeedback({ nodeId, slot, status: "saved", message: "This credential is already bound to the slot." });
      return "saved";
    }
    const bindings: NonNullable<NodeFlowNode["credentialBindings"]> = [];
    let replaced = false;
    for (const binding of node.credentialBindings ?? []) {
      if (binding.slot !== slot) { bindings.push(binding); continue; }
      if (!replaced && credentialId) bindings.push({ slot, credentialId });
      replaced = true;
    }
    if (!replaced && credentialId) bindings.push({ slot, credentialId });
    const nextGraph = updateNodeInGraph(graph, nodeId, { credentialBindings: bindings });
    const targetProjectId = projectId;
    const flowId = record.id;
    const draftRevision = record.version;
    const requestId = ++credentialMutationRequestRef.current;
    const isCurrent = (): boolean => mountedRef.current
      && credentialMutationRequestRef.current === requestId
      && projectRef.current === targetProjectId
      && selectedFlowRef.current === flowId
      && selectedNodeRef.current === nodeId;
    setCredentialFeedback({ nodeId, slot, status: "saving", message: credentialId ? "Saving credential binding…" : "Removing credential binding…" });
    try {
      const result = await patchNodeFlowDraft(flowId, {
        projectId: targetProjectId,
        draftRevision,
        title,
        description,
        graph: nextGraph,
      });
      if (!isCurrent()) return "stale";
      if (result.conflict) {
        const conflictMessage = `${result.conflict.message} Loaded revision ${result.conflict.actualDraftRevision}; choose the credential again to retry.`;
        try {
          const [latest, nextReview] = await Promise.all([
            fetchNodeFlow(flowId),
            validateNodeFlowDraft(targetProjectId, flowId),
          ]);
          if (!isCurrent()) return "stale";
          applyCredentialRecord(latest, nextReview, nodeId);
          setCredentialFeedback({ nodeId, slot, status: "conflict", message: conflictMessage });
        } catch (refreshError) {
          if (!isCurrent()) return "stale";
          setCredentialFeedback({ nodeId, slot, status: "conflict", message: `${conflictMessage} The latest draft could not be refreshed: ${errorMessage(refreshError)}` });
        }
        return "conflict";
      }
      const [saved, nextReview] = await Promise.all([
        fetchNodeFlow(flowId),
        validateNodeFlowDraft(targetProjectId, flowId),
      ]);
      if (!isCurrent()) return "stale";
      applyCredentialRecord(saved, nextReview, nodeId);
      const reviewedCredential = nextReview.requiredCredentials.find((credential) => credential.nodeId === nodeId && credential.slot === slot);
      if (credentialId && reviewedCredential?.status === "denied") {
        setCredentialFeedback({ nodeId, slot, status: "policy-denied", message: "The binding was saved, but current credential policy denies its use. Choose another credential or update it in Settings." });
        return "policy-denied";
      }
      setCredentialFeedback({ nodeId, slot, status: "saved", message: credentialId ? "Credential binding saved and draft review refreshed." : "Credential binding removed and draft review refreshed." });
      return "saved";
    } catch (requestError) {
      if (!isCurrent()) return "stale";
      const policyDenied = requestError instanceof NodeFlowDraftSaveError
        ? requestError.status === 401 || requestError.status === 403
        : /policy|denied|forbidden|not authorized|permission/i.test(errorMessage(requestError));
      setCredentialFeedback({
        nodeId,
        slot,
        status: policyDenied ? "policy-denied" : "error",
        message: policyDenied
          ? `Credential binding was not saved because policy denied the change. ${errorMessage(requestError)}`
          : `Credential binding was not saved. ${errorMessage(requestError)}`,
      });
      return policyDenied ? "policy-denied" : "error";
    }
  };

  if (projectLoading) return <PageContainer><div role="status" className="p-10 text-sm text-slate-500">Loading project workspace…</div></PageContainer>;
  if (!selectedProject) return <PageContainer><PageHeader icon={Workflow} eyebrow="Nodes" title="Automation workspace" subtitle="Select a project to load its governed node-flow library." /><EmptyState icon={<Workflow className="h-7 w-7" />} title="Select a project" description="Flows, credentials, publications, and run history are always scoped to a project." /></PageContainer>;
  return <PageContainer className="gap-5" padding="workbench" aria-labelledby="nodes-workspace-title">
    <PageHeader icon={Workflow} eyebrow={selectedProject.name} title={<span id="nodes-workspace-title">Automation workspace</span>} subtitle="Build from the governed registry, review policy and permissions, publish immutable versions, and debug redacted runs." actions={<><Button size="sm" icon={Plus} onClick={createFlow} disabled={busy}>New draft</Button><Button size="sm" variant="secondary" icon={Save} onClick={save} disabled={busy || !record || !dirty}>Save draft</Button><Button size="sm" variant="secondary" onClick={run} disabled={busy || !record || !review?.publishedVersion}>Run published</Button></>} />
    {error ? <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.07] p-3 text-sm text-status-red"><AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}<button type="button" className="ml-3 underline" onClick={() => void loadLibrary(selectedProject.id)}>Retry</button></div> : null}
    {migrationWarning ? <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{migrationWarning}<button type="button" className="ml-3 underline" onClick={() => setMigrationWarning(null)}>Dismiss</button></div> : null}
    {notice ? <div role="status" className="rounded-xl border border-status-green/20 bg-status-green/[0.06] p-3 text-sm text-slate-700 dark:text-slate-200">{notice}</div> : null}
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row"><NodeFlowLibrary flows={flows} selectedFlowId={selectedFlowId} loading={loading} onSelect={selectFlow} onCreate={createFlow} onDelete={(id) => void act(async () => { await deleteNodeFlow(id); await loadLibrary(selectedProject.id); })} />
      <div className="min-w-0 flex-1">{record ? <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold uppercase text-slate-500">Flow name<input className="mt-1 w-full rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-sm normal-case dark:border-white/[0.08] dark:bg-white/[0.04]" value={title} onInput={(event) => editTitle(event.currentTarget.value)} /></label><label className="text-xs font-bold uppercase text-slate-500">Description<input className="mt-1 w-full rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-sm normal-case dark:border-white/[0.08] dark:bg-white/[0.04]" value={description} onInput={(event) => editDescription(event.currentTarget.value)} /></label></div> : null}{record ? <NodeFlowCanvas graph={graph} selectedNodeId={selectedNodeId} onSelectNode={selectNode} onMoveNode={(id, position) => editGraph((current) => updateNodeInGraph(current, id, { position }))} /> : <EmptyState icon={<Workflow className="h-7 w-7" />} title="No flows in this project" description="Create a draft to start from the canonical backend workspace." primaryAction={<Button onClick={createFlow}>Create draft</Button>} />}</div>
      <NodePalette definitions={catalog} loading={loading} disabled={!record || busy} onCreateNode={addNode} />
      {record ? <NodeFlowInspector selectedNode={selectedNode} definition={selectedDefinition} validation={review ? { valid: review.valid, errors: review.validationIssues } : null} requiredCredentials={review?.requiredCredentials.filter((item) => item.nodeId === selectedNode?.id) ?? []} projectId={selectedProject.id} flowId={record.id} credentialFeedback={credentialFeedback} onCredentialChange={changeCredential} agents={agents} attachments={attachments} attachAgentId={attachAgentId} attachmentsLoading={agentsLoading || attachmentsLoading} attachmentError={attachmentMutationError ?? flowAttachmentError ?? agentsError} attaching={attachmentBusy} onAttachAgentIdChange={setAttachAgentId} onAttachAgent={attachAgent} onDetachAgent={detachAgent} onRetryAttachments={refreshAttachmentData} onNodeChange={(id, update) => editGraph((current) => updateNodeInGraph(current, id, update))} /> : null}
    </div>
    {record ? <><NodeGovernancePanel review={review} dryRun={dryRun} diff={diff} busy={busy} onValidate={validate} onDryRun={runDry} onCompare={compare} onPublish={publish} onRollback={rollback} /><NodeRunDebugger runs={runs} selectedRunId={selectedRunId} nodeRuns={nodeRuns} attempts={attempts} approvals={approvals} busy={busy} onSelectRun={setSelectedRunId} onRefresh={() => void act(refreshRuns)} onCancel={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { await cancelNodeFlowRun(projectId, active.id); await refreshRuns(); }); }} onRetry={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { const result = await retryNodeFlowRun(projectId, active.id); setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); }); }} onApprovalDecision={(approvalId, decision) => void act(async () => { const result = await decideNodeFlowApproval(approvalId, decision); setRuns((current) => current.map((item) => item.id === result.run.id ? result.run : item)); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); setApprovals((current) => current.map((item) => item.id === approvalId ? { ...item, status: result.status, decidedAt: result.decidedAt, decidedBy: result.decidedBy, decision: result.decision, updatedAt: result.updatedAt } : item)); })} /></> : null}
  </PageContainer>;
};
