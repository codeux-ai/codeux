import type {
  AgentPreset,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchAgentPresets = async (projectId: string): Promise<AgentPreset[]> => {
  return fetchJson<AgentPreset[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets`);
};

export const createAgentPreset = async (
  projectId: string,
  input: CreateAgentPresetInput,
): Promise<AgentPreset> => {
  const payload = {
    name: input.name,
    description: input.description,
    instructionMarkdown: input.instructionMarkdown,
    labels: input.labels,
    avatarConfig: input.avatarConfig,
    memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: input.memoryTemplateMarkdown,
  };
  return fetchJson<AgentPreset>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const updateAgentPreset = async (
  agentPresetId: string,
  input: UpdateAgentPresetInput,
): Promise<AgentPreset> => {
  const payload = {
    name: input.name,
    description: input.description,
    instructionMarkdown: input.instructionMarkdown,
    labels: input.labels,
    avatarConfig: input.avatarConfig,
    memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: input.memoryTemplateMarkdown,
  };
  return fetchJson<AgentPreset>(`/api/agent-presets/${encodeURIComponent(agentPresetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
