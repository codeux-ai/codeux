export interface FigmaSearchInput {
  fileKey?: string;
  externalIds?: string[];
  includeConversation?: boolean;
  limit: number;
  baseUrl?: string;
}

export interface FigmaFileItem {
  key: string;
  title: string;
  url: string;
  bodyMarkdown: string;
  conversationMarkdown: string;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

const FIGMA_API_BASE_URL = "https://api.figma.com/v1";

interface FigmaFileResponse {
  name?: string;
  lastModified?: string | null;
  document?: FigmaNode;
}

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  children?: FigmaNode[];
}

interface FigmaCommentsResponse {
  comments?: FigmaComment[];
}

interface FigmaComment {
  id?: string;
  message?: string;
  created_at?: string | null;
  resolved_at?: string | null;
  file_key?: string;
  user?: { handle?: string; id?: string };
  client_meta?: Record<string, unknown>;
}

export async function getFiles(token: string, input: FigmaSearchInput): Promise<FigmaFileItem[]> {
  const fileKeys = uniqueStrings([...(input.externalIds || []), input.fileKey || ""]).slice(0, input.limit);
  const items: FigmaFileItem[] = [];
  for (const fileKey of fileKeys) {
    items.push(await getFile(token, fileKey, input));
  }
  return items;
}

export async function getFile(token: string, fileKey: string, input: Omit<FigmaSearchInput, "fileKey" | "externalIds">): Promise<FigmaFileItem> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const file = await requestFigma<FigmaFileResponse>(`${baseUrl}/files/${encodeURIComponent(fileKey)}`, token);
  const comments = input.includeConversation === true
    ? (await requestFigma<FigmaCommentsResponse>(`${baseUrl}/files/${encodeURIComponent(fileKey)}/comments`, token)).comments || []
    : [];
  const pages = file.document?.children || [];
  return {
    key: fileKey,
    title: file.name || `Figma file ${fileKey}`,
    url: `https://www.figma.com/file/${fileKey}`,
    bodyMarkdown: formatFigmaNodesMarkdown(pages),
    conversationMarkdown: formatCommentsMarkdown(comments),
    updatedAt: file.lastModified || null,
    metadata: {
      pageCount: pages.length,
      pages: pages.slice(0, 50).map((page) => ({
        id: page.id || null,
        name: page.name || null,
        type: page.type || null,
        childCount: page.children?.length || 0,
      })),
    },
  };
}

async function requestFigma<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-Figma-Token": token,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Figma API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function formatFigmaNodesMarkdown(pages: FigmaNode[]): string {
  return pages.slice(0, 50).map((page) => {
    const childLines = (page.children || []).slice(0, 25).map((child) => {
      const text = child.characters?.trim();
      return `- ${child.name || child.id || "Untitled node"}${child.type ? ` (${child.type})` : ""}${text ? `: ${text}` : ""}`;
    });
    return [`## ${page.name || page.id || "Untitled page"}`, ...childLines].join("\n");
  }).join("\n\n").trim();
}

function formatCommentsMarkdown(comments: FigmaComment[]): string {
  return comments
    .filter((comment) => Boolean(comment.message?.trim()))
    .map((comment, index) => {
      const author = comment.user?.handle || comment.user?.id || "unknown";
      const meta = [
        `Comment ${index + 1}`,
        `@${author}`,
        comment.created_at || "",
        comment.resolved_at ? `resolved ${comment.resolved_at}` : "",
      ].filter(Boolean).join(" - ");
      return `##### ${meta}\n\n${comment.message?.trim() || "_No comment body provided._"}`;
    })
    .join("\n\n");
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || FIGMA_API_BASE_URL).replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
