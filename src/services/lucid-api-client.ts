export interface LucidSearchInput {
  documentId?: string;
  search?: string;
  externalIds?: string[];
  limit: number;
  baseUrl?: string;
}

export interface LucidDocumentItem {
  id: string;
  title: string;
  url: string;
  bodyMarkdown: string;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

const LUCID_API_BASE_URL = "https://api.lucid.co";

interface LucidSearchResponse {
  documents?: LucidDocumentSummary[];
  data?: LucidDocumentSummary[];
  results?: LucidDocumentSummary[];
}

interface LucidDocumentSummary {
  id?: string;
  documentId?: string;
  title?: string;
  name?: string;
  url?: string;
  editUrl?: string;
  viewUrl?: string;
  lastModified?: string | null;
  modified?: string | null;
  created?: string | null;
  product?: string | null;
}

export async function searchDocuments(token: string, input: LucidSearchInput): Promise<LucidDocumentItem[]> {
  const ids = uniqueStrings([...(input.externalIds || []), input.documentId || ""]);
  if (ids.length > 0) {
    return getDocuments(token, ids, input);
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const payload = await requestLucid<LucidSearchResponse>(`${baseUrl}/documents/search`, token, {
    method: "POST",
    body: {
      query: input.search || "",
      limit: input.limit,
    },
  });
  return getSearchDocuments(payload)
    .filter((document): document is LucidDocumentSummary & { id: string } => typeof getDocumentId(document) === "string")
    .slice(0, input.limit)
    .map((document) => toDocumentItem(document, ""));
}

export async function getDocuments(token: string, documentIds: string[], input: Omit<LucidSearchInput, "documentId" | "externalIds">): Promise<LucidDocumentItem[]> {
  const items: LucidDocumentItem[] = [];
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  for (const documentId of uniqueStrings(documentIds).slice(0, input.limit)) {
    const contents = await requestLucid<unknown>(`${baseUrl}/v1/documents/${encodeURIComponent(documentId)}/contents`, token);
    items.push(toDocumentItem({ id: documentId }, readableTextFromUnknown(contents), contents));
  }
  return items;
}

async function requestLucid<T>(url: string, token: string, options: {
  method?: string;
  body?: Record<string, unknown>;
} = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Lucid-Api-Version": "1",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Lucid API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function toDocumentItem(summary: LucidDocumentSummary, bodyMarkdown: string, contents?: unknown): LucidDocumentItem {
  const id = getDocumentId(summary) || "unknown-document";
  const contentSummary = summarizeLucidContents(contents);
  return {
    id,
    title: summary.title || summary.name || contentSummary.title || `Lucid document ${id}`,
    url: summary.url || summary.editUrl || summary.viewUrl || `https://lucid.app/documents#/documents/${id}`,
    bodyMarkdown: bodyMarkdown || contentSummary.bodyMarkdown,
    createdAt: summary.created || null,
    updatedAt: summary.lastModified || summary.modified || contentSummary.updatedAt,
    metadata: {
      product: summary.product || null,
      contentTypes: contentSummary.contentTypes,
    },
  };
}

function getSearchDocuments(payload: LucidSearchResponse): LucidDocumentSummary[] {
  return payload.documents || payload.data || payload.results || [];
}

function getDocumentId(document: LucidDocumentSummary): string | undefined {
  return document.id || document.documentId;
}

function summarizeLucidContents(contents: unknown): { title: string; bodyMarkdown: string; updatedAt: string | null; contentTypes: string[] } {
  if (!contents || typeof contents !== "object") {
    return { title: "", bodyMarkdown: "", updatedAt: null, contentTypes: [] };
  }
  const record = contents as Record<string, unknown>;
  const title = readString(record, ["title", "name"]);
  const updatedAt = readString(record, ["lastModified", "modified", "updatedAt"]) || null;
  const contentTypes = Array.from(new Set(collectTypeNames(contents))).slice(0, 20);
  return {
    title,
    bodyMarkdown: readableTextFromUnknown(contents),
    updatedAt,
    contentTypes,
  };
}

function readableTextFromUnknown(value: unknown): string {
  const text = collectReadableText(value, 0);
  return Array.from(new Set(text)).slice(0, 200).join("\n").trim();
}

function collectReadableText(value: unknown, depth: number): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectReadableText(entry, depth + 1));
  const record = value as Record<string, unknown>;
  const direct = readString(record, ["text", "plainText", "content", "label", "title", "name"]);
  return [
    direct,
    ...Object.values(record).flatMap((entry) => collectReadableText(entry, depth + 1)),
  ].filter(Boolean);
}

function collectTypeNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectTypeNames);
  const record = value as Record<string, unknown>;
  return [
    typeof record.type === "string" ? record.type : "",
    typeof record.shapeType === "string" ? record.shapeType : "",
    ...Object.values(record).flatMap(collectTypeNames),
  ].filter(Boolean);
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || LUCID_API_BASE_URL).replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
