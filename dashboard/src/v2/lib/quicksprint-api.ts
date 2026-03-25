import type {
  QuicksprintTemplateRecord,
  QuicksprintExecutionInput,
  CreateQuicksprintTemplateInput,
  UpdateQuicksprintTemplateInput,
} from "../../../../src/contracts/quicksprint-types.js";
import type { SprintRecord } from "../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return await response.json() as T;
};

export const fetchQuicksprintTemplates = async (projectId: string): Promise<QuicksprintTemplateRecord[]> => {
  return fetchJson<QuicksprintTemplateRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/quicksprint/templates`);
};

export const executeQuicksprint = async (projectId: string, input: QuicksprintExecutionInput): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/projects/${encodeURIComponent(projectId)}/quicksprint/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const createCustomQuicksprintTemplate = async (
  projectId: string,
  input: CreateQuicksprintTemplateInput
): Promise<QuicksprintTemplateRecord> => {
  return fetchJson<QuicksprintTemplateRecord>(`/api/projects/${encodeURIComponent(projectId)}/quicksprint/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateCustomQuicksprintTemplate = async (
  projectId: string,
  templateId: string,
  input: UpdateQuicksprintTemplateInput
): Promise<QuicksprintTemplateRecord> => {
  return fetchJson<QuicksprintTemplateRecord>(
    `/api/projects/${encodeURIComponent(projectId)}/quicksprint/templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
};

export const deleteCustomQuicksprintTemplate = async (projectId: string, templateId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/quicksprint/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
    }
  );
};
