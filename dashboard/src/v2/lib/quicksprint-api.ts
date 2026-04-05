import type {
  QuicksprintTemplateRecord,
  QuicksprintExecutionInput,
  CreateQuicksprintTemplateInput,
  UpdateQuicksprintTemplateInput,
} from "../../../../src/contracts/quicksprint-types.js";
import type { SprintRecord } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchQuicksprintTemplates = async (projectId: string): Promise<QuicksprintTemplateRecord[]> => {
  return fetchJson<QuicksprintTemplateRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/quicksprints/templates`);
};

export const executeQuicksprint = async (projectId: string, input: QuicksprintExecutionInput): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/projects/${encodeURIComponent(projectId)}/quicksprints/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const createCustomQuicksprintTemplate = async (
  projectId: string,
  input: CreateQuicksprintTemplateInput
): Promise<QuicksprintTemplateRecord> => {
  return fetchJson<QuicksprintTemplateRecord>(`/api/projects/${encodeURIComponent(projectId)}/quicksprints/templates`, {
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
    `/api/projects/${encodeURIComponent(projectId)}/quicksprints/templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
};

export const deleteCustomQuicksprintTemplate = async (projectId: string, templateId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/quicksprints/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
    }
  );
};
