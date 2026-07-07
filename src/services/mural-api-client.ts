export interface MuralSearchInput {
  workspaceId?: string;
  muralId?: string;
  search?: string;
  externalIds?: string[];
  limit: number;
  baseUrl?: string;
}

export interface MuralItem {
  id: string;
  workspaceId: string | null;
  title: string;
  url: string;
  bodyMarkdown: string;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

const MURAL_API_BASE_URL = "https://app.mural.co/api/public/v1";

interface MuralListResponse {
  value?: MuralRaw[];
  data?: MuralRaw[];
  murals?: MuralRaw[];
}

interface MuralRaw {
  id?: string;
  muralId?: string;
  title?: string;
  name?: string;
  url?: string;
  visitorUrl?: string;
  thumbnailUrl?: string;
  workspaceId?: string;
  createdOn?: string | null;
  createdAt?: string | null;
  updatedOn?: string | null;
  updatedAt?: string | null;
  description?: string | null;
  content?: unknown;
}

export async function searchMurals(token: string, input: MuralSearchInput): Promise<MuralItem[]> {
  const ids = uniqueStrings([...(input.externalIds || []), input.muralId || ""]);
  if (ids.length > 0) {
    return getMurals(token, ids, input);
  }
  if (!input.workspaceId?.trim()) {
    throw new Error("Mural workspace ID is required for mural search.");
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const payload = await requestMural<MuralListResponse>(
    `${baseUrl}/workspaces/${encodeURIComponent(input.workspaceId.trim())}/murals`,
    token,
  );
  return getMuralList(payload)
    .filter((mural): mural is MuralRaw & { id: string } => typeof getMuralId(mural) === "string")
    .filter((mural) => !input.search?.trim() || getMuralTitle(mural).toLowerCase().includes(input.search.trim().toLowerCase()))
    .slice(0, input.limit)
    .map((mural) => toMuralItem(mural, input.workspaceId || null));
}

export async function getMurals(token: string, muralIds: string[], input: Omit<MuralSearchInput, "muralId" | "externalIds">): Promise<MuralItem[]> {
  const items: MuralItem[] = [];
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  for (const muralId of uniqueStrings(muralIds).slice(0, input.limit)) {
    const mural = await requestMural<MuralRaw>(`${baseUrl}/murals/${encodeURIComponent(muralId)}`, token);
    items.push(toMuralItem(mural, input.workspaceId || mural.workspaceId || null, muralId));
  }
  return items;
}

async function requestMural<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Mural API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function toMuralItem(mural: MuralRaw, workspaceId: string | null, fallbackId?: string): MuralItem {
  const id = getMuralId(mural) || fallbackId || "unknown-mural";
  const contentMarkdown = readableTextFromUnknown(mural.content);
  return {
    id,
    workspaceId,
    title: getMuralTitle(mural) || `Mural ${id}`,
    url: mural.url || mural.visitorUrl || `https://app.mural.co/t/${workspaceId || "workspace"}/m/${id}`,
    bodyMarkdown: [mural.description || "", contentMarkdown].filter(Boolean).join("\n\n").trim(),
    createdAt: mural.createdAt || mural.createdOn || null,
    updatedAt: mural.updatedAt || mural.updatedOn || null,
    metadata: {
      workspaceId,
      thumbnailUrl: mural.thumbnailUrl || null,
      limitedMetadata: true,
    },
  };
}

function getMuralList(payload: MuralListResponse): MuralRaw[] {
  return payload.value || payload.data || payload.murals || [];
}

function getMuralId(mural: MuralRaw): string | undefined {
  return mural.id || mural.muralId;
}

function getMuralTitle(mural: MuralRaw): string {
  return mural.title || mural.name || "";
}

function readableTextFromUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.flatMap(readableTextFromUnknown).filter(Boolean).slice(0, 200).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = ["text", "plainText", "content", "title", "name"]
    .map((key) => record[key])
    .find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return [
    direct || "",
    ...Object.values(record).map(readableTextFromUnknown),
  ].filter(Boolean).slice(0, 200).join("\n");
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || MURAL_API_BASE_URL).replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
