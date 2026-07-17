import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, Plus, Save, Workflow } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { Button } from "./components/ui/Button.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { UnsavedChangesModal } from "./components/ui/UnsavedChangesModal.js";
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
import { useNodesI18n } from "./i18n/messages/nodes.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";

export const NODES_CANVAS_STORAGE_KEY = "codeux:nodes-canvas:v1";
const migrationMarker = (projectId: string): string => `codeux:nodes-canvas:imported:${projectId}`;

type LifecycleOperation = "save" | "validate" | "dryRun" | "publish" | "rollback" | "run";
type LifecycleStatus = "idle" | "pending" | "success" | "error";
interface LifecycleFeedback { status: LifecycleStatus; message: string | null }
type DraftTransition = { type: "select"; flowId: string } | { type: "create" } | { type: "delete"; flowId: string } | { type: "reload" };

const LIFECYCLE_OPERATIONS: LifecycleOperation[] = ["save", "validate", "dryRun", "publish", "rollback", "run"];
const createLifecycleFeedback = (): Record<LifecycleOperation, LifecycleFeedback> => ({
  save: { status: "idle", message: null },
  validate: { status: "idle", message: null },
  dryRun: { status: "idle", message: null },
  publish: { status: "idle", message: null },
  rollback: { status: "idle", message: null },
  run: { status: "idle", message: null },
});

export const NodesPage: FunctionComponent = () => {
  const { t } = useNodesI18n();
  const interactionTokens = useInteractionTokens();
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm: closeConfirmedDelete, handleCancel: cancelDeleteConfirm } = useConfirmDialog();
  const cancelDeleteConfirmRef = useRef(cancelDeleteConfirm);
  cancelDeleteConfirmRef.current = cancelDeleteConfirm;
  const translateRef = useRef(t);
  translateRef.current = t;
  const errorMessage = useCallback((requestError: unknown): string => (
    requestError instanceof Error ? requestError.message : translateRef.current("requestFailed")
  ), []);
  const { selectedProject, loading: projectLoading } = useProjectData();
  const projectId = selectedProject?.id ?? null;
  const projectRef = useRef(projectId); projectRef.current = projectId;
  const flowRef = useRef<string | null>(null);
  const selectedFlowRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const reviewRequestRef = useRef(0);
  const credentialMutationRequestRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const lifecycleRequestRef = useRef<Partial<Record<LifecycleOperation, number>>>({});
  const lifecyclePendingRef = useRef(new Set<LifecycleOperation>());
  const flowsRef = useRef<NodeFlowRecord[]>([]);
  const deletePendingRef = useRef<string | null>(null);
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
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<DraftTransition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NodeFlowRecord | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [lifecycleFeedback, setLifecycleFeedback] = useState(createLifecycleFeedback);
  const [error, setError] = useState<string | null>(null);
  const [migrationWarning, setMigrationWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialFeedback, setCredentialFeedback] = useState<CredentialBindingFeedback | null>(null);

  const selectedNode = useMemo(() => graph.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId]);
  const selectedDefinition = selectedNode?.definition ? definitions[`${selectedNode.definition.type}@${selectedNode.definition.version}`] ?? null : null;
  const dirty = isNodeFlowDirty(record, title, description, graph);
  const titleError = title.trim() ? null : t("flowNameRequired");
  flowRef.current = record?.id ?? null;
  flowsRef.current = flows;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; reviewRequestRef.current += 1; credentialMutationRequestRef.current += 1; lifecycleGenerationRef.current += 1; lifecyclePendingRef.current.clear(); };
  }, []);

  const resetLifecycleFeedback = useCallback((): void => {
    lifecycleGenerationRef.current += 1;
    lifecyclePendingRef.current.clear();
    lifecycleRequestRef.current = {};
    setLifecycleFeedback(createLifecycleFeedback());
  }, []);

  const applyRecord = useCallback((flow: NodeFlowRecord, preserveLifecycleFeedback = false): void => {
    if (!preserveLifecycleFeedback) resetLifecycleFeedback();
    flowRef.current = flow.id; selectedFlowRef.current = flow.id;
    setRecord(flow); setSelectedFlowId(flow.id); setTitle(flow.title); setDescription(flow.description); setGraph(flow.graph);
    selectedNodeRef.current = flow.graph.nodes[0]?.id ?? null; setSelectedNodeId(selectedNodeRef.current); setReview(null); setDryRun(null); setDiff(null);
  }, [resetLifecycleFeedback]);

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
  }, [errorMessage]);

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
          setNotice(translateRef.current("legacyImported"));
        } catch (migrationError) {
          if (!signal?.aborted && projectRef.current === nextProjectId) {
            setMigrationWarning(translateRef.current("legacyImportFailed", { diagnostic: errorMessage(migrationError) }));
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
  }, [applyRecord, errorMessage, loadReview]);

  useEffect(() => {
    flowRef.current = null; selectedFlowRef.current = null; selectedNodeRef.current = null; reviewRequestRef.current += 1; credentialMutationRequestRef.current += 1;
    resetLifecycleFeedback(); deletePendingRef.current = null;
    setFlows([]); setRecord(null); setSelectedFlowId(null); setRuns([]); setAgents([]); setAttachments([]); setAttachAgentId(""); setAgentsError(null); setFlowAttachmentError(null); setAttachmentMutationError(null); setAttachmentBusy(false); setError(null); setMigrationWarning(null); setNotice(null);
    setPendingTransition(null); setDeleteTarget(null); setPendingDeleteId(null); setTransitionBusy(false); cancelDeleteConfirmRef.current();
    setCredentialFeedback(null);
    if (!projectId) return;
    const controller = new AbortController(); void loadLibrary(projectId, controller.signal); return () => controller.abort();
  }, [projectId, loadLibrary, resetLifecycleFeedback]);

  const loadAgents = useCallback(async (nextProjectId: string, signal?: AbortSignal): Promise<void> => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const nextAgents = await fetchAgentPresets(nextProjectId, signal);
      if (projectRef.current !== nextProjectId) return;
      setAgents(nextAgents);
      setAttachAgentId((current) => nextAgents.some((agent) => agent.id === current) ? current : "");
    } catch (requestError) {
      if (!signal?.aborted && projectRef.current === nextProjectId) setAgentsError(translateRef.current("agentsLoadFailed", { diagnostic: errorMessage(requestError) }));
    } finally {
      if (!signal?.aborted && projectRef.current === nextProjectId) setAgentsLoading(false);
    }
  }, [errorMessage]);

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
      if (!signal?.aborted && flowRef.current === flowId) setFlowAttachmentError(translateRef.current("attachmentsLoadFailed", { diagnostic: errorMessage(requestError) }));
    } finally {
      if (!signal?.aborted && flowRef.current === flowId) setAttachmentsLoading(false);
    }
  }, [errorMessage]);

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
  }, [errorMessage, selectedNode?.definition?.type, selectedNode?.definition?.version]);

  const refreshRuns = useCallback(async (): Promise<void> => {
    if (!record) return;
    const flowId = record.id;
    const response = await fetchNodeFlowRuns(flowId);
    if (flowRef.current !== flowId) return;
    setRuns(response.runs); setSelectedRunId((current) => current ?? response.runs[0]?.id ?? null);
  }, [record]);
  useEffect(() => { setRuns([]); setSelectedRunId(null); if (record) void refreshRuns().catch((requestError) => setError(errorMessage(requestError))); }, [errorMessage, record?.id, refreshRuns]);
  useEffect(() => { if (!selectedRunId) { setNodeRuns([]); setAttempts([]); setApprovals([]); return; } const controller = new AbortController(); void Promise.all([fetchNodeFlowNodeRuns(selectedRunId, controller.signal), fetchNodeFlowAttempts(selectedRunId, controller.signal), fetchNodeFlowApprovals(selectedRunId, controller.signal)]).then(([nodes, history, governed]) => { setNodeRuns(nodes.nodeRuns); setAttempts(history.attempts); setApprovals(governed.approvals); }).catch((requestError) => { if (!controller.signal.aborted) setError(errorMessage(requestError)); }); return () => controller.abort(); }, [errorMessage, selectedRunId]);

  const act = async (action: () => Promise<void>): Promise<void> => { setAuxiliaryBusy(true); setError(null); setNotice(null); try { await action(); } catch (requestError) { if (mountedRef.current) setError(errorMessage(requestError)); } finally { if (mountedRef.current) setAuxiliaryBusy(false); } };
  const runLifecycleOperation = async (
    operation: LifecycleOperation,
    pendingMessage: string,
    action: (isCurrent: () => boolean) => Promise<LifecycleFeedback>,
  ): Promise<boolean> => {
    if (lifecyclePendingRef.current.has(operation)) return false;
    const targetProjectId = projectId;
    const flowId = record?.id ?? null;
    if (!targetProjectId || !flowId) return false;
    const generation = lifecycleGenerationRef.current;
    const requestId = (lifecycleRequestRef.current[operation] ?? 0) + 1;
    lifecycleRequestRef.current[operation] = requestId;
    lifecyclePendingRef.current.add(operation);
    const isCurrent = (): boolean => mountedRef.current
      && lifecycleGenerationRef.current === generation
      && lifecycleRequestRef.current[operation] === requestId
      && projectRef.current === targetProjectId
      && flowRef.current === flowId;
    setLifecycleFeedback((current) => ({ ...current, [operation]: { status: "pending", message: pendingMessage } }));
    try {
      const feedback = await action(isCurrent);
      if (!isCurrent()) return false;
      setLifecycleFeedback((current) => ({ ...current, [operation]: feedback }));
      return feedback.status === "success";
    } catch (requestError) {
      if (!isCurrent()) return false;
      setLifecycleFeedback((current) => ({ ...current, [operation]: { status: "error", message: errorMessage(requestError) } }));
      return false;
    } finally {
      if (lifecycleRequestRef.current[operation] === requestId) lifecyclePendingRef.current.delete(operation);
    }
  };
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
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentMutationError(t("attachFailed", { diagnostic: errorMessage(requestError) }));
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
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentMutationError(t("detachFailed", { diagnostic: errorMessage(requestError) }));
    }).finally(() => {
      if (projectRef.current === mutationProjectId && flowRef.current === flowId) setAttachmentBusy(false);
    });
  };
  const saveDraft = async (): Promise<boolean> => {
    if (!projectId || !record || titleError) return false;
    const targetProjectId = projectId;
    const flowId = record.id;
    const draftRevision = record.version;
    return runLifecycleOperation("save", t("savePending"), async (isCurrent) => {
      const result = await patchNodeFlowDraft(flowId, { projectId: targetProjectId, draftRevision, title, description, graph });
      if (result.conflict) throw new Error(`${result.conflict.message} ${t("currentRevision", { revision: result.conflict.actualDraftRevision })}`);
      const saved = await fetchNodeFlow(flowId);
      if (!isCurrent()) return { status: "success", message: t("draftSaved") };
      setFlows((current) => current.map((item) => item.id === saved.id ? saved : item));
      applyRecord(saved, true);
      setReview(result.draft ?? null);
      return { status: "success", message: t("draftSaved") };
    });
  };

  const selectFlowNow = (flowId: string): void => {
    const flow = flowsRef.current.find((item) => item.id === flowId);
    if (!flow || !projectId || flow.id === selectedFlowRef.current) return;
    credentialMutationRequestRef.current += 1; setCredentialFeedback(null); applyRecord(flow); void loadReview(projectId, flow.id);
  };
  const createFlowNow = async (): Promise<void> => {
    if (!projectId || transitionBusy) return;
    const targetProjectId = projectId;
    setTransitionBusy(true); setError(null);
    try {
      const created = await createNodeFlowDraft(targetProjectId, { title: t("untitledAutomation"), description: "", graph: createDefaultNodeFlowGraph() });
      if (projectRef.current !== targetProjectId) return;
      const flow = await fetchNodeFlow(created.flowId);
      if (projectRef.current !== targetProjectId || !mountedRef.current) return;
      setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]); applyRecord(flow); setReview(created); setNotice(t("draftCreated"));
    } catch (requestError) {
      if (projectRef.current === targetProjectId) setError(errorMessage(requestError));
    } finally {
      if (projectRef.current === targetProjectId) setTransitionBusy(false);
    }
  };
  const openDeleteConfirm = (flowId: string): void => {
    if (deletePendingRef.current) return;
    const flow = flowsRef.current.find((item) => item.id === flowId);
    if (!flow) return;
    setDeleteTarget(flow);
    void requestConfirm({
      title: t("deleteFlowTitle", { title: flow.title }),
      body: t("deleteFlowBody", { title: flow.title }),
      confirmLabel: t("deleteFlowConfirm"),
      cancelLabel: t("cancel"),
      destructive: true,
    });
  };
  const executeTransition = (transition: DraftTransition): void => {
    if (transition.type === "select") selectFlowNow(transition.flowId);
    else if (transition.type === "create") void createFlowNow();
    else if (transition.type === "delete") openDeleteConfirm(transition.flowId);
    else if (projectId) void loadLibrary(projectId);
  };
  const requestDraftTransition = (transition: DraftTransition): void => {
    if (lifecyclePendingRef.current.has("save") || transitionBusy || pendingTransition) return;
    if (transition.type === "select" && transition.flowId === selectedFlowRef.current) return;
    const replacesDraft = transition.type !== "delete" || transition.flowId === selectedFlowRef.current;
    if (dirty && replacesDraft) setPendingTransition(transition);
    else executeTransition(transition);
  };
  const selectFlow = (flowId: string): void => requestDraftTransition({ type: "select", flowId });
  const createFlow = (): void => requestDraftTransition({ type: "create" });
  const requestDeleteFlow = (flowId: string): void => requestDraftTransition({ type: "delete", flowId });
  const discardAndContinue = (): void => {
    const transition = pendingTransition;
    setPendingTransition(null);
    if (transition) executeTransition(transition);
  };
  const saveAndContinue = (): void => {
    if (!pendingTransition || lifecyclePendingRef.current.has("save")) return;
    const transition = pendingTransition;
    void saveDraft().then((saved) => {
      if (!saved || !mountedRef.current) return;
      setPendingTransition(null);
      executeTransition(transition);
    });
  };
  const confirmDeleteFlow = async (): Promise<void> => {
    const target = deleteTarget;
    if (!target || deletePendingRef.current || !projectId) return;
    const targetProjectId = projectId;
    deletePendingRef.current = target.id; setPendingDeleteId(target.id); setError(null);
    try {
      await deleteNodeFlow(target.id);
      if (projectRef.current !== targetProjectId || !mountedRef.current) return;
      const remaining = flowsRef.current.filter((flow) => flow.id !== target.id);
      setFlows(remaining);
      if (selectedFlowRef.current === target.id) {
        const next = remaining[0] ?? null;
        if (next) { applyRecord(next); void loadReview(targetProjectId, next.id); }
        else {
          resetLifecycleFeedback(); flowRef.current = null; selectedFlowRef.current = null; selectedNodeRef.current = null;
          setRecord(null); setSelectedFlowId(null); setSelectedNodeId(null); setTitle(""); setDescription(""); setGraph(createDefaultNodeFlowGraph()); setReview(null); setDryRun(null); setDiff(null);
        }
      }
      setNotice(t("flowDeleted", { title: target.title })); setDeleteTarget(null); closeConfirmedDelete();
    } catch (requestError) {
      if (projectRef.current === targetProjectId) setError(t("deleteFlowFailed", { title: target.title, diagnostic: errorMessage(requestError) }));
      setDeleteTarget(null); cancelDeleteConfirm();
    } finally {
      if (deletePendingRef.current === target.id) { deletePendingRef.current = null; setPendingDeleteId(null); }
    }
  };
  const addNode = (summary: NodeDefinitionSummary): void => { void act(async () => { const definition = await fetchNodeDefinition(summary.type, summary.version); setDefinitions((current) => ({ ...current, [`${definition.type}@${definition.version}`]: definition })); let suffix = 1; while (graph.nodes.some((node) => node.id === `${definition.type}-${suffix}`)) suffix += 1; const node: NodeFlowNode = { id: `${definition.type}-${suffix}`, type: definition.type, title: definition.ui.label, description: definition.ui.description, definition: { type: definition.type, version: definition.version }, ports: definition.ports, widgetSchema: definition.ui.widgetSchema, data: {}, capabilities: definition.capabilities, sideEffect: definition.sideEffect, policy: definition.defaultPolicy, credentialBindings: [], position: { x: 80 + graph.nodes.length * 260, y: 100 } }; setGraph((current) => ({ ...current, nodes: [...current.nodes, node] })); selectedNodeRef.current = node.id; credentialMutationRequestRef.current += 1; setCredentialFeedback(null); setSelectedNodeId(node.id); }); };
  const validate = (): void => {
    if (!projectId || !record) return;
    const targetProjectId = projectId; const flowId = record.id;
    void runLifecycleOperation("validate", t("validatePending"), async (isCurrent) => {
      const nextReview = await validateNodeFlowDraft(targetProjectId, flowId);
      if (isCurrent()) setReview(nextReview);
      return nextReview.valid
        ? { status: "success", message: t("validateSuccess") }
        : { status: "error", message: t("validateIssues", { count: nextReview.validationIssues.length }) };
    });
  };
  const runDry = (): void => {
    if (!projectId || !record) return;
    const targetProjectId = projectId; const flowId = record.id;
    void runLifecycleOperation("dryRun", t("dryRunPending"), async (isCurrent) => {
      const result = await dryRunNodeFlowDraft(targetProjectId, flowId);
      if (isCurrent()) setDryRun(result);
      return result.status === "ready"
        ? { status: "success", message: t("dryRunSuccess") }
        : { status: "error", message: t("dryRunBlocked") };
    });
  };
  const publish = (): void => {
    if (!projectId || !record || !review) return;
    const targetProjectId = projectId; const flowId = record.id; const draftRevision = review.draftRevision;
    void runLifecycleOperation("publish", t("publishPending"), async (isCurrent) => {
      const nextReview = await publishNodeFlowDraft(targetProjectId, flowId, draftRevision);
      if (isCurrent()) setReview(nextReview);
      return { status: "success", message: t("draftPublished") };
    });
  };
  const compare = (): void => { if (!projectId || !record || !review?.publishedVersion) return; const publishedVersion = review.publishedVersion; void act(async () => setDiff(await compareNodeFlowVersions(projectId, record.id, publishedVersion, record.version))); };
  const rollback = (): void => {
    if (!projectId || !record || !review?.publishedVersion) return;
    const targetProjectId = projectId; const flowId = record.id; const publishedVersion = review.publishedVersion; const draftRevision = record.version;
    void runLifecycleOperation("rollback", t("rollbackPending"), async (isCurrent) => {
      const next = await rollbackNodeFlow(targetProjectId, flowId, publishedVersion, draftRevision);
      const flow = await fetchNodeFlow(flowId);
      if (isCurrent()) { applyRecord(flow, true); setReview(next); }
      return { status: "success", message: t("rollbackSuccess", { version: publishedVersion }) };
    });
  };
  const run = (): void => {
    if (!projectId || !record) return;
    const targetProjectId = projectId; const flowId = record.id;
    void runLifecycleOperation("run", t("runPending"), async (isCurrent) => {
      const result = await runNodeFlow(flowId, { projectId: targetProjectId, input: {} });
      if (isCurrent()) { setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); }
      return { status: "success", message: t("runStarted", { id: result.run.id }) };
    });
  };
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

  const fieldControlStyle = { transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease };
  const inlineValidationStyle = { transitionDuration: interactionTokens.inlineValidation.duration, transitionTimingFunction: interactionTokens.inlineValidation.ease };
  const retryLifecycleOperation = (operation: LifecycleOperation): void => {
    if (operation === "save") void saveDraft();
    else if (operation === "validate") validate();
    else if (operation === "dryRun") runDry();
    else if (operation === "publish") publish();
    else if (operation === "rollback") rollback();
    else run();
  };
  const clearLifecycleFeedback = (operation: LifecycleOperation): void => setLifecycleFeedback((current) => ({ ...current, [operation]: { status: "idle", message: null } }));
  const lifecycleOperationLabel = (operation: LifecycleOperation): string => {
    if (operation === "save") return t("saveDraft");
    if (operation === "dryRun") return t("dryRun");
    if (operation === "run") return t("run");
    return t(operation);
  };

  if (projectLoading) return <PageContainer><div role="status" className="p-10 text-sm text-slate-500">{t("loadingProjectWorkspace")}</div></PageContainer>;
  if (!selectedProject) return <PageContainer><PageHeader icon={Workflow} eyebrow={t("nodes")} title={t("automationWorkspace")} subtitle={t("selectProjectSubtitle")} /><EmptyState icon={<Workflow className="h-7 w-7" />} title={t("selectProject")} description={t("projectScopeDescription")} /></PageContainer>;
  return <PageContainer className="gap-5" padding="workbench" aria-labelledby="nodes-workspace-title" data-feedback-focus-fallback>
    <PageHeader icon={Workflow} eyebrow={selectedProject.name} title={<span id="nodes-workspace-title">{t("automationWorkspace")}</span>} subtitle={t("workspaceSubtitle")} actions={<><Button size="sm" icon={Plus} onClick={createFlow} disabled={transitionBusy || lifecyclePendingRef.current.has("save")}>{t("newDraft")}</Button><Button size="sm" variant="secondary" icon={Save} onClick={() => void saveDraft()} disabled={!record || !dirty || Boolean(titleError) || lifecycleFeedback.save.status === "pending"}>{t("saveDraft")}</Button><Button size="sm" variant="secondary" onClick={run} disabled={!record || !review?.publishedVersion || lifecycleFeedback.run.status === "pending"}>{t("runPublished")}</Button></>} />
    {error ? <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.07] p-3 text-sm text-status-red"><AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}<button type="button" className="ml-3 underline" onClick={() => requestDraftTransition({ type: "reload" })}>{t("retry")}</button></div> : null}
    {migrationWarning ? <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{migrationWarning}<button type="button" className="ml-3 underline" onClick={() => setMigrationWarning(null)}>{t("dismiss")}</button></div> : null}
    {notice ? <div role="status" className="rounded-xl border border-status-green/20 bg-status-green/[0.06] p-3 text-sm text-slate-700 dark:text-slate-200">{notice}</div> : null}
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label={t("lifecycleFeedback")}>
      {LIFECYCLE_OPERATIONS.map((operation) => <ActionFeedbackRegion
        key={operation}
        status={lifecycleFeedback[operation].status}
        message={lifecycleFeedback[operation].message}
        autoDismiss={false}
        retryAction={lifecycleFeedback[operation].status === "error" ? () => retryLifecycleOperation(operation) : undefined}
        retryPending={lifecycleFeedback[operation].status === "pending"}
        retryLabel={t("retryOperation", { operation: lifecycleOperationLabel(operation) })}
        onDismiss={() => clearLifecycleFeedback(operation)}
      />)}
    </div>
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row"><NodeFlowLibrary flows={flows} selectedFlowId={selectedFlowId} loading={loading} transitionPending={transitionBusy || lifecyclePendingRef.current.has("save")} pendingDeleteId={pendingDeleteId} onSelect={selectFlow} onCreate={createFlow} onDelete={requestDeleteFlow} />
      <div className="min-w-0 flex-1">{record ? <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold uppercase text-slate-500">{t("flowName")}<input aria-invalid={titleError ? "true" : undefined} aria-describedby={titleError ? "flow-name-error" : undefined} style={titleError ? inlineValidationStyle : fieldControlStyle} className={`mt-1 w-full rounded-xl border bg-white/70 px-3 py-2 text-sm normal-case outline-none focus:ring-2 focus:ring-signal-500/30 dark:bg-white/[0.04] ${titleError ? "border-status-red/50 dark:border-status-red/50" : "border-black/[0.08] dark:border-white/[0.08]"}`} value={title} onInput={(event) => editTitle(event.currentTarget.value)} />{titleError ? <span id="flow-name-error" role="alert" className="mt-1 block text-xs normal-case text-status-red" style={inlineValidationStyle}>{titleError}</span> : null}</label><label className="text-xs font-bold uppercase text-slate-500">{t("description")}<input style={fieldControlStyle} className="mt-1 w-full rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-sm normal-case outline-none focus:ring-2 focus:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04]" value={description} onInput={(event) => editDescription(event.currentTarget.value)} /></label></div> : null}{record ? <NodeFlowCanvas graph={graph} selectedNodeId={selectedNodeId} onSelectNode={selectNode} onMoveNode={(id, position) => editGraph((current) => updateNodeInGraph(current, id, { position }))} /> : <EmptyState icon={<Workflow className="h-7 w-7" />} title={t("noProjectFlows")} description={t("createDraftDescription")} primaryAction={<Button onClick={createFlow}>{t("createDraft")}</Button>} />}</div>
      <NodePalette definitions={catalog} loading={loading} disabled={!record || auxiliaryBusy} onCreateNode={addNode} />
      {record ? <NodeFlowInspector selectedNode={selectedNode} definition={selectedDefinition} validation={review ? { valid: review.valid, errors: review.validationIssues } : null} requiredCredentials={review?.requiredCredentials.filter((item) => item.nodeId === selectedNode?.id) ?? []} projectId={selectedProject.id} flowId={record.id} credentialFeedback={credentialFeedback} onCredentialChange={changeCredential} agents={agents} attachments={attachments} attachAgentId={attachAgentId} attachmentsLoading={agentsLoading || attachmentsLoading} attachmentError={attachmentMutationError ?? flowAttachmentError ?? agentsError} attaching={attachmentBusy} onAttachAgentIdChange={setAttachAgentId} onAttachAgent={attachAgent} onDetachAgent={detachAgent} onRetryAttachments={refreshAttachmentData} onNodeChange={(id, update) => editGraph((current) => updateNodeInGraph(current, id, update))} /> : null}
    </div>
    {record ? <><NodeGovernancePanel review={review} dryRun={dryRun} diff={diff} busy={auxiliaryBusy} onValidate={validate} onDryRun={runDry} onCompare={compare} onPublish={publish} onRollback={rollback} /><NodeRunDebugger runs={runs} selectedRunId={selectedRunId} nodeRuns={nodeRuns} attempts={attempts} approvals={approvals} busy={auxiliaryBusy} onSelectRun={setSelectedRunId} onRefresh={() => void act(refreshRuns)} onCancel={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { await cancelNodeFlowRun(projectId, active.id); await refreshRuns(); }); }} onRetry={() => { const active = runs.find((item) => item.id === selectedRunId); if (projectId && active) void act(async () => { const result = await retryNodeFlowRun(projectId, active.id); setRuns((current) => [result.run, ...current]); setSelectedRunId(result.run.id); }); }} onApprovalDecision={(approvalId, decision) => void act(async () => { const result = await decideNodeFlowApproval(approvalId, decision); setRuns((current) => current.map((item) => item.id === result.run.id ? result.run : item)); setNodeRuns(result.nodeRuns); setAttempts(result.attempts ?? []); setApprovals((current) => current.map((item) => item.id === approvalId ? { ...item, status: result.status, decidedAt: result.decidedAt, decidedBy: result.decidedBy, decision: result.decision, updatedAt: result.updatedAt } : item)); })} /></> : null}
    {pendingTransition ? <UnsavedChangesModal onCancel={() => setPendingTransition(null)} onConfirm={discardAndContinue} onSave={saveAndContinue} saving={lifecycleFeedback.save.status === "pending"} /> : null}
    <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={confirmDeleteFlow} onCancel={() => { setDeleteTarget(null); cancelDeleteConfirm(); }} />
  </PageContainer>;
};
