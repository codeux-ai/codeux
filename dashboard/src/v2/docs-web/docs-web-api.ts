import type {
  DocsWebCollectionResponse,
  DocsWebDocumentResponse,
} from "../../../../src/contracts/docs-web-types.js";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return await response.json() as T;
}

export function fetchDocsWebCollection(): Promise<DocsWebCollectionResponse> {
  return fetchJson<DocsWebCollectionResponse>("/api/docs-web");
}

export function fetchDocsWebDocument(docId: string): Promise<DocsWebDocumentResponse> {
  return fetchJson<DocsWebDocumentResponse>(`/api/docs-web/${encodeURIComponent(docId)}`);
}
