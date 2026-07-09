export interface MiroSearchInput {
  boardId?: string;
  search?: string;
  itemTypes?: string[];
  externalIds?: string[];
  limit: number;
  baseUrl?: string;
}

export interface MiroCanvasItem {
  id: string;
  boardId: string;
  title: string;
  type: string;
  url: string;
  bodyMarkdown: string;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

const MIRO_API_BASE_URL = "https://api.miro.com/v2";

interface MiroListResponse<T> {
  data?: T[];
}

interface MiroBoard {
  id?: string;
  name?: string;
  viewLink?: string;
  modifiedAt?: string | null;
  createdAt?: string | null;
  team?: { id?: string; name?: string };
}

interface MiroRawItem {
  id?: string;
  type?: string;
  links?: { self?: string; related?: string };
  data?: Record<string, unknown>;
  position?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  createdAt?: string | null;
  modifiedAt?: string | null;
}

export async function searchBoards(token: string, input: MiroSearchInput): Promise<MiroCanvasItem[]> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (input.boardId?.trim()) {
    return getBoardItems(token, input.boardId.trim(), input, baseUrl);
  }

  const boards = await listBoards(token, input, baseUrl);
  return boards
    .filter((board): board is MiroBoard & { id: string } => typeof board.id === "string" && board.id.trim().length > 0)
    .slice(0, input.limit)
    .map((board) => toBoardItem(board));
}

export async function getBoardItems(
  token: string,
  boardId: string,
  input: Omit<MiroSearchInput, "boardId">,
  baseUrl = normalizeBaseUrl(input.baseUrl),
): Promise<MiroCanvasItem[]> {
  const url = new URL(`${baseUrl}/boards/${encodeURIComponent(boardId)}/items`);
  url.searchParams.set("limit", String(input.limit));
  if (input.itemTypes && input.itemTypes.length > 0) {
    url.searchParams.set("type", input.itemTypes.join(","));
  }
  const payload = await requestMiro<MiroListResponse<MiroRawItem>>(url.toString(), token);
  const externalIds = new Set(uniqueStrings(input.externalIds || []));
  const itemResults = (payload.data || [])
    .filter((item): item is MiroRawItem & { id: string } => typeof item.id === "string" && item.id.trim().length > 0)
    .filter((item) => externalIds.size === 0 || externalIds.has(item.id))
    .slice(0, input.limit)
    .map((item) => toCanvasItem(boardId, item));
  const boardItem = syntheticBoardItem(boardId);
  if (externalIds.size > 0) {
    return externalIds.has(boardId) ? [boardItem, ...itemResults].slice(0, input.limit) : itemResults;
  }
  return [boardItem, ...itemResults].slice(0, input.limit);
}

async function listBoards(token: string, input: MiroSearchInput, baseUrl: string): Promise<MiroBoard[]> {
  const url = new URL(`${baseUrl}/boards`);
  url.searchParams.set("limit", String(input.limit));
  if (input.search?.trim()) {
    url.searchParams.set("query", input.search.trim());
  }
  const payload = await requestMiro<MiroListResponse<MiroBoard>>(url.toString(), token);
  return payload.data || [];
}

async function requestMiro<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Miro API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function toBoardItem(board: MiroBoard & { id: string }): MiroCanvasItem {
  return {
    id: board.id,
    boardId: board.id,
    title: board.name || "Untitled Miro board",
    type: "board",
    url: board.viewLink || `https://miro.com/app/board/${board.id}/`,
    bodyMarkdown: "",
    createdAt: board.createdAt || null,
    updatedAt: board.modifiedAt || null,
    metadata: {
      boardId: board.id,
      teamId: board.team?.id || null,
      teamName: board.team?.name || null,
    },
  };
}

function syntheticBoardItem(boardId: string): MiroCanvasItem {
  return {
    id: boardId,
    boardId,
    title: `Miro board ${boardId}`,
    type: "board",
    url: `https://miro.com/app/board/${boardId}/`,
    bodyMarkdown: "",
    createdAt: null,
    updatedAt: null,
    metadata: {
      boardId,
    },
  };
}

function toCanvasItem(boardId: string, item: MiroRawItem & { id: string }): MiroCanvasItem {
  const type = item.type || "item";
  const title = readText(item.data, ["title", "name", "content", "text", "plainText"]) || `${type}:${item.id}`;
  return {
    id: item.id,
    boardId,
    title,
    type,
    url: item.links?.self || `https://miro.com/app/board/${boardId}/?moveToWidget=${item.id}`,
    bodyMarkdown: dataToMarkdown(item.data),
    createdAt: item.createdAt || null,
    updatedAt: item.modifiedAt || null,
    metadata: {
      boardId,
      type,
      position: item.position || null,
      geometry: item.geometry || null,
    },
  };
}

function dataToMarkdown(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const lines = [
    readText(data, ["title", "name"]),
    readText(data, ["content", "text", "plainText", "description"]),
  ].filter(Boolean);
  return Array.from(new Set(lines)).join("\n\n").trim();
}

function readText(data: Record<string, unknown> | undefined, keys: string[]): string {
  if (!data) return "";
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return stripHtml(value);
    }
  }
  return "";
}

function stripHtml(value: string): string {
  const withoutHtml = value
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  return withoutHtml.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || MIRO_API_BASE_URL).replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
