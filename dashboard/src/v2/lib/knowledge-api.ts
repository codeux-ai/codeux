import { fetchJson } from "../../lib/api/fetch-json.js";

export type KnowledgeDocumentStatus = "pending" | "embedding" | "ready" | "error";
export type KnowledgeSourceType = "upload" | "repo_path" | "paste";

export interface KnowledgeDocument {
  id: string;
  projectId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string | null;
  mimeType: string | null;
  byteSize: number;
  charCount: number;
  tokenCount: number;
  summary: string;
  contentHash: string;
  status: KnowledgeDocumentStatus;
  embeddingModel: string | null;
  chunkCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  subscriberAgentIds: string[];
}

export interface KnowledgeSearchResult {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  similarity: number;
}

export interface KnowledgeUploadResult {
  documents: KnowledgeDocument[];
  errors: Array<{ fileName: string; error: string }>;
}

const encode = encodeURIComponent;

export const fetchKnowledgeDocuments = async (projectId: string): Promise<KnowledgeDocument[]> =>
  fetchJson<KnowledgeDocument[]>(`/api/projects/${encode(projectId)}/knowledge/documents`);

export const addPastedDocument = async (
  projectId: string,
  input: { title: string; text: string },
): Promise<KnowledgeDocument> =>
  fetchJson<KnowledgeDocument>(`/api/projects/${encode(projectId)}/knowledge/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, text: input.text }),
  });

export const addRepoPathDocuments = async (
  projectId: string,
  repoPath: string,
): Promise<KnowledgeUploadResult> =>
  fetchJson<KnowledgeUploadResult>(`/api/projects/${encode(projectId)}/knowledge/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath }),
  });

export const uploadKnowledgeFiles = async (
  projectId: string,
  files: File[],
): Promise<KnowledgeUploadResult> => {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }
  const response = await fetch(`/api/projects/${encode(projectId)}/knowledge/documents/upload`, {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Upload failed";
    throw new Error(message);
  }
  return body as KnowledgeUploadResult;
};

export const deleteKnowledgeDocument = async (documentId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/knowledge/documents/${encode(documentId)}`, { method: "DELETE" });
};

export const reembedKnowledgeDocument = async (documentId: string): Promise<KnowledgeDocument> =>
  fetchJson<KnowledgeDocument>(`/api/knowledge/documents/${encode(documentId)}/reembed`, { method: "POST" });

export const searchKnowledge = async (
  projectId: string,
  input: { query: string; documentIds?: string[]; agentPresetId?: string; limit?: number },
): Promise<KnowledgeSearchResult[]> =>
  fetchJson<KnowledgeSearchResult[]>(`/api/projects/${encode(projectId)}/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const fetchAgentKnowledgeSubscriptions = async (agentPresetId: string): Promise<string[]> => {
  const result = await fetchJson<{ documentIds: string[] }>(`/api/agent-presets/${encode(agentPresetId)}/knowledge`);
  return result.documentIds ?? [];
};

export const setAgentKnowledgeSubscriptions = async (
  agentPresetId: string,
  documentIds: string[],
): Promise<string[]> => {
  const result = await fetchJson<{ documentIds: string[] }>(
    `/api/agent-presets/${encode(agentPresetId)}/knowledge/subscriptions`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds }),
    },
  );
  return result.documentIds ?? [];
};
