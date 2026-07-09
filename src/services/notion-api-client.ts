export interface NotionSearchInput {
  search?: string;
  databaseId?: string;
  externalIds?: string[];
  limit: number;
}

export interface NotionItem {
  id: string;
  object: "page" | "database";
  title: string;
  url: string;
  archived: boolean;
  createdTime: string | null;
  lastEditedTime: string | null;
  bodyMarkdown: string;
  metadata: Record<string, unknown>;
}

const NOTION_API_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface NotionRichText {
  plain_text?: string;
}

interface NotionTitleProperty {
  title?: NotionRichText[];
}

interface NotionRawObject {
  id?: string;
  object?: string;
  url?: string;
  archived?: boolean;
  created_time?: string;
  last_edited_time?: string;
  title?: NotionRichText[];
  properties?: Record<string, NotionTitleProperty | unknown>;
  parent?: Record<string, unknown>;
}

interface NotionBlock {
  id?: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface NotionListResponse<T> {
  results?: T[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export async function searchObjects(token: string, input: NotionSearchInput): Promise<NotionItem[]> {
  const body: Record<string, unknown> = {
    page_size: input.limit,
    sort: {
      direction: "descending",
      timestamp: "last_edited_time",
    },
  };
  if (input.search?.trim()) {
    body.query = input.search.trim();
  }

  const payload = await requestNotion<NotionListResponse<NotionRawObject>>(`${NOTION_API_BASE_URL}/search`, token, {
    method: "POST",
    body,
  });

  return Promise.all((payload.results || [])
    .filter((item): item is NotionRawObject & { id: string } => isNotionSearchObject(item))
    .filter((item) => !input.databaseId || getNotionParentDatabaseId(item) === input.databaseId)
    .slice(0, input.limit)
    .map((item) => toNotionItem(token, item)));
}

export async function getObjects(token: string, externalIds: string[], limit = 50): Promise<NotionItem[]> {
  const items: NotionItem[] = [];
  for (const externalId of uniqueStrings(externalIds).slice(0, limit)) {
    const item = await getObject(token, externalId);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

async function getObject(token: string, externalId: string): Promise<NotionItem | null> {
  const page = await tryRequestNotion<NotionRawObject>(`${NOTION_API_BASE_URL}/pages/${encodeURIComponent(externalId)}`, token);
  if (page && isNotionSearchObject(page)) {
    return toNotionItem(token, page);
  }

  const database = await tryRequestNotion<NotionRawObject>(`${NOTION_API_BASE_URL}/databases/${encodeURIComponent(externalId)}`, token);
  if (database && isNotionSearchObject(database)) {
    return toNotionItem(token, database);
  }

  return null;
}

async function toNotionItem(token: string, item: NotionRawObject & { id: string }): Promise<NotionItem> {
  const blocks = await listBlockChildren(token, item.id);
  return {
    id: item.id,
    object: item.object === "database" ? "database" : "page",
    title: getNotionTitle(item),
    url: item.url || `https://www.notion.so/${item.id.replace(/-/g, "")}`,
    archived: item.archived === true,
    createdTime: item.created_time || null,
    lastEditedTime: item.last_edited_time || null,
    bodyMarkdown: blocksToMarkdown(blocks),
    metadata: {
      object: item.object || null,
      parent: item.parent || null,
      databaseId: getNotionParentDatabaseId(item),
    },
  };
}

async function listBlockChildren(token: string, blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${NOTION_API_BASE_URL}/blocks/${encodeURIComponent(blockId)}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) {
      url.searchParams.set("start_cursor", cursor);
    }
    const payload = await tryRequestNotion<NotionListResponse<NotionBlock>>(url.toString(), token);
    if (!payload) {
      return blocks;
    }
    blocks.push(...(payload.results || []));
    cursor = payload.has_more ? payload.next_cursor || null : null;
  } while (cursor);
  return blocks;
}

async function requestNotion<T>(url: string, token: string, options: {
  method?: string;
  body?: Record<string, unknown>;
} = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Notion API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

async function tryRequestNotion<T>(url: string, token: string): Promise<T | null> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Notion API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function isNotionSearchObject(item: NotionRawObject): item is NotionRawObject & { id: string } {
  return typeof item.id === "string" && (item.object === "page" || item.object === "database");
}

function getNotionTitle(item: NotionRawObject): string {
  const directTitle = richTextToPlain(item.title);
  if (directTitle) {
    return directTitle;
  }
  for (const value of Object.values(item.properties || {})) {
    const title = value && typeof value === "object" ? richTextToPlain((value as NotionTitleProperty).title) : "";
    if (title) {
      return title;
    }
  }
  return item.object === "database" ? "Untitled database" : "Untitled page";
}

function getNotionParentDatabaseId(item: NotionRawObject): string | null {
  const parent = item.parent || {};
  return typeof parent.database_id === "string" ? parent.database_id : null;
}

function blocksToMarkdown(blocks: NotionBlock[]): string {
  return blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function blockToMarkdown(block: NotionBlock): string {
  const type = block.type;
  const value = typeof type === "string" && block[type] && typeof block[type] === "object"
    ? block[type] as Record<string, unknown>
    : {};
  const text = richTextToPlain(value.rich_text as NotionRichText[] | undefined);
  if (!text) {
    return "";
  }
  if (type === "heading_1") return `# ${text}`;
  if (type === "heading_2") return `## ${text}`;
  if (type === "heading_3") return `### ${text}`;
  if (type === "bulleted_list_item") return `- ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  if (type === "to_do") return `- [${value.checked === true ? "x" : " "}] ${text}`;
  if (type === "quote") return `> ${text}`;
  if (type === "code") return `\`\`\`\n${text}\n\`\`\``;
  return text;
}

function richTextToPlain(value: NotionRichText[] | undefined): string {
  return (value || [])
    .map((entry) => entry.plain_text || "")
    .join("")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
