import type {
  AgentPreset,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return await response.json() as T;
};

export const fetchAgentPresets = async (projectId: string): Promise<AgentPreset[]> => {
  return fetchJson<AgentPreset[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets`);
};

export const createAgentPreset = async (
  projectId: string,
  input: CreateAgentPresetInput,
): Promise<AgentPreset> => {
  return fetchJson<AgentPreset>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateAgentPreset = async (
  agentPresetId: string,
  input: UpdateAgentPresetInput,
): Promise<AgentPreset> => {
  return fetchJson<AgentPreset>(`/api/agent-presets/${encodeURIComponent(agentPresetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteAgentPreset = async (agentPresetId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/agent-presets/${encodeURIComponent(agentPresetId)}`, {
    method: "DELETE",
  });
};

export const importAgentPresetFromMarkdown = async (agentPresetId: string): Promise<AgentPreset> => {
  return fetchJson<AgentPreset>(`/api/agent-presets/${encodeURIComponent(agentPresetId)}/import-markdown`, {
    method: "POST",
  });
};

export const syncAllAgentPresetsFromMarkdown = async (projectId: string): Promise<AgentPreset[]> => {
  return fetchJson<AgentPreset[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets/sync-markdown`, {
    method: "POST",
  });
};
