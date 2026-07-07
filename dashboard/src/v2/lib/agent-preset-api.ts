import type {
  AgentPreset,
  CreateAgentPresetInput,
  SkillStorageKind,
  SkillStorageRecord,
  UpdateAgentPresetInput,
} from "../types.js";
import type { PushAgentPresetsToMarkdownOptions } from "../../../../src/contracts/agent-preset-types.js";
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
    providerConfigId: input.providerConfigId,
    model: input.model,
    containerRunAsRoot: input.containerRunAsRoot,
    memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: input.memoryTemplateMarkdown,
    memoryConfig: input.memoryConfig,
    persistentSkillStorageIds: input.persistentSkillStorageIds,
    persistentSkillStorage: input.persistentSkillStorage,
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
    providerConfigId: input.providerConfigId,
    model: input.model,
    containerRunAsRoot: input.containerRunAsRoot,
    memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: input.memoryTemplateMarkdown,
    mcpAccess: input.mcpAccess,
    memoryConfig: input.memoryConfig,
    persistentSkillStorageIds: input.persistentSkillStorageIds,
    persistentSkillStorage: input.persistentSkillStorage,
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

export const pullAgentPresetsFromMarkdown = async (projectId: string): Promise<AgentPreset[]> => {
  return fetchJson<AgentPreset[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets/pull-markdown`, {
    method: "POST",
  });
};

export const pushAgentPresetsToMarkdown = async (
  projectId: string,
  options: PushAgentPresetsToMarkdownOptions = {},
): Promise<AgentPreset[]> => {
  return fetchJson<AgentPreset[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-presets/push-markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
};

export const exportAgentPresetToMarkdown = async (agentPresetId: string): Promise<AgentPreset> => {
  return fetchJson<AgentPreset>(`/api/agent-presets/${encodeURIComponent(agentPresetId)}/export-markdown`, {
    method: "POST",
  });
};

export const pushAgentPresetsToRepository = async (
  projectId: string,
  options: { mode: "commit_only" | "commit_and_push" | "pull_request"; branchName?: string },
): Promise<{ committed: boolean; pushedBranch?: string; pullRequestUrl?: string }> => {
  return fetchJson<{ committed: boolean; pushedBranch?: string; pullRequestUrl?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent-presets/push`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: options.mode,
        branchName: options.branchName,
      }),
    },
  );
};

export const fetchSkillStorages = async (projectId: string): Promise<SkillStorageRecord[]> => {
  return fetchJson<SkillStorageRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/skill-storages`);
};

export const createSkillStorage = async (
  projectId: string,
  input: { name: string; description?: string; storageKind?: SkillStorageKind },
): Promise<SkillStorageRecord> => {
  return fetchJson<SkillStorageRecord>(`/api/projects/${encodeURIComponent(projectId)}/skill-storages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteSkillStorage = async (projectId: string, storageId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/skill-storages/${encodeURIComponent(storageId)}`,
    { method: "DELETE" },
  );
};
