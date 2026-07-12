import type {
  EffectiveSettingsResponse,
  DesignGuidanceSettings,
  PreviewEnvironmentVariable,
  ProjectSettings,
  SystemSettings,
  TechstackSelectionSettings,
} from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

let systemSettingsCache: SystemSettings | null = null;
let systemSettingsInflightRequest: Promise<SystemSettings> | null = null;
const effectiveSettingsCache = new Map<string, EffectiveSettingsResponse>();
const effectiveSettingsInflightRequests = new Map<string, Promise<EffectiveSettingsResponse>>();

const LEGACY_SECRET_SETTING_KEYS = new Set([
  "apiKey",
  "apiToken",
  "apiSecret",
  "githubToken",
  "gitlabToken",
]);

/** Keeps compatibility fields present while guaranteeing ordinary settings writes never carry secrets. */
export const sanitizeSettingsSavePayload = <T>(settings: T): T => {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      LEGACY_SECRET_SETTING_KEYS.has(key) ? "" : visit(nested),
    ]));
  };
  return visit(settings) as T;
};

export const clearSettingsApiCacheForTests = (): void => {
  systemSettingsCache = null;
  systemSettingsInflightRequest = null;
  clearEffectiveSettingsRequests();
};

const clearEffectiveSettingsRequests = (projectId?: string): void => {
  if (projectId) {
    effectiveSettingsCache.delete(projectId);
    effectiveSettingsInflightRequests.delete(projectId);
    return;
  }
  effectiveSettingsCache.clear();
  effectiveSettingsInflightRequests.clear();
};

export const fetchSystemSettings = async (): Promise<SystemSettings> => {
  if (systemSettingsCache) {
    return systemSettingsCache;
  }
  if (!systemSettingsInflightRequest) {
    systemSettingsInflightRequest = fetchJson<SystemSettings>("/api/system-settings").then((settings) => {
      systemSettingsCache = settings;
      return settings;
    }).finally(() => {
      systemSettingsInflightRequest = null;
    });
  }
  return systemSettingsInflightRequest;
};

export const saveSystemSettings = async (settings: SystemSettings): Promise<SystemSettings> => {
  const payload = sanitizeSettingsSavePayload(settings);
  const saved = await fetchJson<SystemSettings>("/api/system-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  systemSettingsCache = saved;
  clearEffectiveSettingsRequests();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
      detail: { scope: "system" },
    }));
  }
  return saved;
};

export const resetSystemDatabase = async (): Promise<void> => {
  await fetchJson<{ ok: boolean }>("/api/system/reset-database", {
    method: "POST",
  });
};

export const fetchProjectEffectiveSettings = async (
  projectId: string,
  init?: RequestInit
): Promise<EffectiveSettingsResponse> => {
  const url = `/api/projects/${encodeURIComponent(projectId)}/settings/effective`;
  const bypassCache = init?.cache === "reload";
  if (!init?.signal && !bypassCache && effectiveSettingsCache.has(projectId)) {
    return effectiveSettingsCache.get(projectId)!;
  }

  if (init?.signal || bypassCache) {
    const settings = await fetchJson<EffectiveSettingsResponse>(url, init);
    if (!init?.signal?.aborted) {
      effectiveSettingsCache.set(projectId, settings);
    }
    return settings;
  }

  let request = effectiveSettingsInflightRequests.get(projectId);
  if (!request) {
    request = fetchJson<EffectiveSettingsResponse>(url, init).then((settings) => {
      effectiveSettingsCache.set(projectId, settings);
      return settings;
    }).finally(() => {
      effectiveSettingsInflightRequests.delete(projectId);
    });
    effectiveSettingsInflightRequests.set(projectId, request);
  }
  return request;
};

export const saveProjectSettings = async (projectId: string, settings: ProjectSettings): Promise<void> => {
  const payload = sanitizeSettingsSavePayload(settings);
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  clearEffectiveSettingsRequests(projectId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
      detail: { scope: "project", projectId },
    }));
  }
};

export const saveProjectPreviewEnvironmentVariables = async (
  projectId: string,
  environmentVariables: PreviewEnvironmentVariable[],
): Promise<EffectiveSettingsResponse> => {
  const effective = await fetchProjectEffectiveSettings(projectId, { cache: "reload" });
  await saveProjectSettings(projectId, {
    ...(effective.settings as ProjectSettings),
    sprintPreview: {
      ...effective.settings.sprintPreview,
      environmentVariables,
    },
  });
  return fetchProjectEffectiveSettings(projectId, { cache: "reload" });
};

export const saveProjectPreviewDockerAccess = async (
  projectId: string,
  allowDockerAccess: boolean,
): Promise<EffectiveSettingsResponse> => {
  const effective = await fetchProjectEffectiveSettings(projectId, { cache: "reload" });
  await saveProjectSettings(projectId, {
    ...(effective.settings as ProjectSettings),
    sprintPreview: {
      ...effective.settings.sprintPreview,
      allowDockerAccess,
    },
  });
  return fetchProjectEffectiveSettings(projectId, { cache: "reload" });
};

export const saveProjectTechstackSettings = async (
  projectId: string,
  techstack: TechstackSelectionSettings,
): Promise<void> => {
  const currentOverride = await fetchJson<Partial<ProjectSettings>>(
    `/api/projects/${encodeURIComponent(projectId)}/settings`,
    { cache: "reload" },
  );
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...currentOverride,
      techstack,
    }),
  });
  clearEffectiveSettingsRequests(projectId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
      detail: { scope: "project", projectId },
    }));
  }
};

export const saveProjectDesignGuidanceSettings = async (
  projectId: string,
  designGuidance: DesignGuidanceSettings,
): Promise<void> => {
  const currentOverride = await fetchJson<Partial<ProjectSettings>>(
    `/api/projects/${encodeURIComponent(projectId)}/settings`,
    { cache: "reload" },
  );
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...currentOverride,
      designGuidance,
    }),
  });
  clearEffectiveSettingsRequests(projectId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
      detail: { scope: "project", projectId },
    }));
  }
};

export const resetProjectSettings = async (projectId: string): Promise<void> => {
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "DELETE",
  });
  clearEffectiveSettingsRequests(projectId);
};

export const fetchSprintEffectiveSettings = async (
  projectId: string,
  sprintId: string,
): Promise<EffectiveSettingsResponse> => {
  return fetchJson<EffectiveSettingsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/settings/effective`
  );
};

export const saveSprintSettings = async (
  projectId: string,
  sprintId: string,
  settings: ProjectSettings,
): Promise<void> => {
  const payload = sanitizeSettingsSavePayload(settings);
  await fetchJson(`/api/sprints/${encodeURIComponent(sprintId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      ...payload,
    }),
  });
};

export const resetSprintSettings = async (sprintId: string): Promise<void> => {
  await fetchJson(`/api/sprints/${encodeURIComponent(sprintId)}/settings`, {
    method: "DELETE",
  });
};
