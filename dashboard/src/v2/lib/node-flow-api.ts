import type {
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
  UpdateNodeFlowInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export interface RunNodeFlowInput {
  projectId: string;
  input?: NodeFlowJsonObject;
  triggerPayload?: NodeFlowJsonObject;
}

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
