import type {
  AutomationApprovalRecord,
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowListResponse,
  NodeFlowNodeRunListResponse,
  NodeFlowRecord,
  NodeFlowRunListResponse,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
  NodeFlowJsonObject,
  NodeDefinitionManifest,
  NodeFlowDraftReview,
  NodeFlowConcurrencyConflict,
  NodeFlowNodeAttemptRecord,
  PatchNodeFlowDraftInput,
  UpdateNodeFlowInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export interface RunNodeFlowInput {
  projectId: string;
  input?: NodeFlowJsonObject;
  triggerPayload?: NodeFlowJsonObject;
}

export interface NodeFlowCatalogResponse {
  nodes: NodeDefinitionSummary[];
}

export interface NodeDefinitionSummary {
  type: string;
  version: number;
  executable: boolean;
  executionKind: NodeDefinitionManifest["executionKind"];
  label: string;
  description: string;
  category: string;
  credentials: NodeDefinitionManifest["credentials"];
  capabilities: string[];
  sideEffect: NodeDefinitionManifest["sideEffect"];
  ports: NodeDefinitionManifest["ports"];
}

export interface PatchNodeFlowDraftResponse {
  draft?: NodeFlowDraftReview;
  conflict?: NodeFlowConcurrencyConflict;
}

export interface NodeFlowDryRunResponse {
  status: "ready" | "blocked";
  draftRevision: number;
  validationIssues: NodeFlowDraftReview["validationIssues"];
  policyFindings: NodeFlowDraftReview["policyFindings"];
  requiredCredentials: NodeFlowDraftReview["requiredCredentials"];
  requestedCapabilities: string[];
  sideEffectDiffs: NodeFlowDraftReview["sideEffectDiffs"];
  result: { executed: false; inputKeys: string[]; output: null };
}

export interface NodeFlowVersionDiff {
  flowId: string;
  fromVersion: number;
  toVersion: number;
  nodeCount: { from: number; to: number };
  edgeCount: { from: number; to: number };
  addedNodeIds: string[];
  removedNodeIds: string[];
  sideEffectDiffs: NodeFlowDraftReview["sideEffectDiffs"];
}

export const fetchNodeFlowCatalog = async (signal?: AbortSignal): Promise<NodeFlowCatalogResponse> =>
  fetchJson<NodeFlowCatalogResponse>("/api/node-flow-catalog", { signal });

export const fetchNodeDefinition = async (type: string, version?: number, signal?: AbortSignal): Promise<NodeDefinitionManifest> => {
  const query = version === undefined ? "" : `?version=${encodeURIComponent(String(version))}`;
  return fetchJson<NodeDefinitionManifest>(`/api/node-flow-catalog/${encodeURIComponent(type)}${query}`, { signal });
};

export const createNodeFlowDraft = async (projectId: string, input: CreateNodeFlowInput): Promise<NodeFlowDraftReview> =>
  fetchJson<NodeFlowDraftReview>(`/api/projects/${encodeURIComponent(projectId)}/node-flow-drafts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });

export const patchNodeFlowDraft = async (flowId: string, input: PatchNodeFlowDraftInput): Promise<PatchNodeFlowDraftResponse> =>
  fetchJson<PatchNodeFlowDraftResponse>(`/api/node-flow-drafts/${encodeURIComponent(flowId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });

export const validateNodeFlowDraft = async (projectId: string, flowId: string): Promise<NodeFlowDraftReview> =>
  fetchJson<NodeFlowDraftReview>(`/api/node-flow-drafts/${encodeURIComponent(flowId)}/validate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
  });

export const dryRunNodeFlowDraft = async (projectId: string, flowId: string, input: NodeFlowJsonObject = {}): Promise<NodeFlowDryRunResponse> =>
  fetchJson<NodeFlowDryRunResponse>(`/api/node-flow-drafts/${encodeURIComponent(flowId)}/dry-run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, input }),
  });

export const requestNodeFlowCredential = async (projectId: string, flowId: string, nodeId: string, slot: string): Promise<Record<string, unknown>> =>
  fetchJson<Record<string, unknown>>(`/api/node-flow-drafts/${encodeURIComponent(flowId)}/credential-requests`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, nodeId, slot }),
  });

export const publishNodeFlowDraft = async (projectId: string, flowId: string, draftRevision: number): Promise<NodeFlowDraftReview> =>
  fetchJson<NodeFlowDraftReview>(`/api/node-flow-drafts/${encodeURIComponent(flowId)}/publish`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, draftRevision, publishedBy: "dashboard" }),
  });

export const compareNodeFlowVersions = async (projectId: string, flowId: string, fromVersion: number, toVersion: number): Promise<NodeFlowVersionDiff> => {
  const query = new URLSearchParams({ projectId, fromVersion: String(fromVersion), toVersion: String(toVersion) });
  return fetchJson<NodeFlowVersionDiff>(`/api/node-flows/${encodeURIComponent(flowId)}/compare?${query.toString()}`);
};

export const rollbackNodeFlow = async (projectId: string, flowId: string, version: number, draftRevision: number): Promise<NodeFlowDraftReview> =>
  fetchJson<NodeFlowDraftReview>(`/api/node-flows/${encodeURIComponent(flowId)}/rollback`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, version, draftRevision }),
  });

export const cancelNodeFlowRun = async (projectId: string, runId: string): Promise<NodeFlowRunRecord> =>
  fetchJson<NodeFlowRunRecord>(`/api/node-flow-runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
  });

export const retryNodeFlowRun = async (projectId: string, runId: string): Promise<NodeFlowRunSummaryResponse> =>
  fetchJson<NodeFlowRunSummaryResponse>(`/api/node-flow-runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
  });

export const fetchNodeFlowAttempts = async (runId: string, signal?: AbortSignal): Promise<{ attempts: NodeFlowNodeAttemptRecord[] }> =>
  fetchJson<{ attempts: NodeFlowNodeAttemptRecord[] }>(`/api/node-flow-runs/${encodeURIComponent(runId)}/attempts`, { signal });

export const fetchNodeFlowApprovals = async (runId: string, signal?: AbortSignal): Promise<{ approvals: AutomationApprovalRecord[] }> =>
  fetchJson<{ approvals: AutomationApprovalRecord[] }>(`/api/node-flow-runs/${encodeURIComponent(runId)}/approvals`, { signal });

export const decideNodeFlowApproval = async (
  approvalId: string,
  decision: "approve" | "reject",
  decidedBy = "dashboard",
): Promise<AutomationApprovalRecord & NodeFlowRunSummaryResponse> =>
  fetchJson<AutomationApprovalRecord & NodeFlowRunSummaryResponse>(`/api/automation-approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, decidedBy }),
  });

export const resumeNodeFlowApproval = async (projectId: string, runId: string, approvalId: string): Promise<NodeFlowRunSummaryResponse> =>
  fetchJson<NodeFlowRunSummaryResponse>(`/api/node-flow-runs/${encodeURIComponent(runId)}/resume-approval`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, approvalId }),
  });

export const fetchNodeFlows = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<NodeFlowListResponse> => {
  return fetchJson<NodeFlowListResponse>(`/api/projects/${encodeURIComponent(projectId)}/node-flows`, { signal });
};

export const fetchNodeFlow = async (flowId: string, signal?: AbortSignal): Promise<NodeFlowRecord> => {
  return fetchJson<NodeFlowRecord>(`/api/node-flows/${encodeURIComponent(flowId)}`, { signal });
};

export const createNodeFlow = async (
  projectId: string,
  input: CreateNodeFlowInput,
): Promise<NodeFlowRecord> => {
  return fetchJson<NodeFlowRecord>(`/api/projects/${encodeURIComponent(projectId)}/node-flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateNodeFlow = async (
  flowId: string,
  input: UpdateNodeFlowInput,
): Promise<NodeFlowRecord> => {
  return fetchJson<NodeFlowRecord>(`/api/node-flows/${encodeURIComponent(flowId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteNodeFlow = async (flowId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/node-flows/${encodeURIComponent(flowId)}`, {
    method: "DELETE",
  });
};

export const validateNodeFlow = async (
  flowId: string,
  graph?: UpdateNodeFlowInput["graph"],
): Promise<NodeFlowValidationResponse> => {
  return fetchJson<NodeFlowValidationResponse>(`/api/node-flows/${encodeURIComponent(flowId)}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph ? { graph } : {}),
  });
};

export const runNodeFlow = async (
  flowId: string,
  input: RunNodeFlowInput,
): Promise<NodeFlowRunSummaryResponse> => {
  return fetchJson<NodeFlowRunSummaryResponse>(`/api/node-flows/${encodeURIComponent(flowId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const fetchNodeFlowRuns = async (
  flowId: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<NodeFlowRunListResponse> => {
  const url = new URL(`/api/node-flows/${encodeURIComponent(flowId)}/runs`, window.location.origin);
  url.searchParams.set("limit", String(limit));
  return fetchJson<NodeFlowRunListResponse>(`${url.pathname}${url.search}`, { signal });
};

export const fetchNodeFlowRun = async (runId: string, signal?: AbortSignal): Promise<NodeFlowRunRecord> => {
  return fetchJson<NodeFlowRunRecord>(`/api/node-flow-runs/${encodeURIComponent(runId)}`, { signal });
};

export const fetchNodeFlowNodeRuns = async (
  runId: string,
  signal?: AbortSignal,
): Promise<NodeFlowNodeRunListResponse> => {
  return fetchJson<NodeFlowNodeRunListResponse>(`/api/node-flow-runs/${encodeURIComponent(runId)}/node-runs`, { signal });
};

export const fetchNodeFlowAgentSkills = async (
  flowId: string,
  signal?: AbortSignal,
): Promise<NodeFlowSkillAttachment[]> => {
  return fetchJson<NodeFlowSkillAttachment[]>(`/api/node-flows/${encodeURIComponent(flowId)}/agent-skills`, { signal });
};

export const attachNodeFlowToAgent = async (
  flowId: string,
  input: AttachNodeFlowSkillInput,
): Promise<NodeFlowSkillAttachment> => {
  return fetchJson<NodeFlowSkillAttachment>(`/api/node-flows/${encodeURIComponent(flowId)}/agent-skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const detachNodeFlowFromAgent = async (flowId: string, agentPresetId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/node-flows/${encodeURIComponent(flowId)}/agent-skills`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentPresetId }),
  });
};
