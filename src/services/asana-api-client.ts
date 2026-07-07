export interface AsanaSearchInput {
  workspaceId?: string;
  projectId?: string;
  search?: string;
  status?: string;
  labels?: string[];
  assignee?: string;
  externalIds?: string[];
  includeConversation?: boolean;
  limit: number;
}

export interface AsanaTaskItem {
  id: string;
  gid: string;
  title: string;
  url: string;
  completed: boolean;
  state: string;
  labels: string[];
  assignees: string[];
  bodyMarkdown: string;
  conversationMarkdown: string;
  createdAt: string | null;
  updatedAt: string | null;
  issueAuthor: string | null;
  metadata: Record<string, unknown>;
}

const ASANA_API_BASE_URL = "https://app.asana.com/api/1.0";
const TASK_FIELDS = [
  "gid",
  "name",
  "notes",
  "permalink_url",
  "completed",
  "completed_at",
  "created_at",
  "modified_at",
  "assignee.name",
  "memberships.project.gid",
  "memberships.project.name",
  "memberships.section.name",
  "projects.gid",
  "projects.name",
  "tags.name",
  "created_by.name",
].join(",");

interface AsanaResponse<T> {
  data?: T;
}

interface AsanaListResponse<T> {
  data?: T[];
}

interface AsanaUser {
  gid?: string;
  name?: string;
}

interface AsanaTask {
  gid?: string;
  name?: string;
  notes?: string | null;
  permalink_url?: string;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string | null;
  modified_at?: string | null;
  assignee?: AsanaUser | null;
  created_by?: AsanaUser | null;
  projects?: Array<{ gid?: string; name?: string }>;
  tags?: Array<{ name?: string }>;
  memberships?: Array<{
    project?: { gid?: string; name?: string };
    section?: { name?: string };
  }>;
}

interface AsanaStory {
  gid?: string;
  type?: string;
  text?: string;
  created_at?: string | null;
  created_by?: AsanaUser | null;
}

export async function searchTasks(token: string, input: AsanaSearchInput): Promise<AsanaTaskItem[]> {
  if (input.externalIds && input.externalIds.length > 0) {
    return getTasks(token, input.externalIds, input);
  }

  const payload = input.projectId
    ? await listProjectTasks(token, input)
    : await searchWorkspaceTasks(token, input);

  return Promise.all((payload.data || [])
    .filter((task): task is AsanaTask & { gid: string } => typeof task.gid === "string")
    .slice(0, input.limit)
    .map((task) => toAsanaTaskItem(token, task, input.includeConversation === true)));
}

export async function getTasks(token: string, externalIds: string[], input: Omit<AsanaSearchInput, "externalIds">): Promise<AsanaTaskItem[]> {
  const items: AsanaTaskItem[] = [];
  for (const gid of uniqueStrings(externalIds).slice(0, input.limit)) {
    const task = await getTask(token, gid);
    if (task?.gid) {
      items.push(await toAsanaTaskItem(token, task as AsanaTask & { gid: string }, input.includeConversation !== false));
    }
  }
  return items;
}

async function searchWorkspaceTasks(token: string, input: AsanaSearchInput): Promise<AsanaListResponse<AsanaTask>> {
  if (!input.workspaceId) {
    throw new Error("Asana workspace ID is required for task search.");
  }
  const url = new URL(`${ASANA_API_BASE_URL}/workspaces/${encodeURIComponent(input.workspaceId)}/tasks/search`);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("opt_fields", TASK_FIELDS);
  if (input.search?.trim()) {
    url.searchParams.set("text", input.search.trim());
  }
  if (input.status === "closed" || input.status === "done") {
    url.searchParams.set("completed", "true");
  } else if (input.status === "open" || input.status === "in_progress" || !input.status || input.status === "all") {
    url.searchParams.set("completed", input.status === "all" ? "any" : "false");
  }
  if (input.assignee?.trim()) {
    url.searchParams.set("assignee.any", input.assignee.trim());
  }
  if (input.projectId?.trim()) {
    url.searchParams.set("projects.any", input.projectId.trim());
  }
  if (input.labels && input.labels.length > 0) {
    url.searchParams.set("tags.any", input.labels.join(","));
  }
  return requestAsana<AsanaListResponse<AsanaTask>>(url.toString(), token);
}

async function listProjectTasks(token: string, input: AsanaSearchInput): Promise<AsanaListResponse<AsanaTask>> {
  const url = new URL(`${ASANA_API_BASE_URL}/projects/${encodeURIComponent(input.projectId || "")}/tasks`);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("opt_fields", TASK_FIELDS);
  return requestAsana<AsanaListResponse<AsanaTask>>(url.toString(), token);
}

async function getTask(token: string, gid: string): Promise<AsanaTask | null> {
  const url = new URL(`${ASANA_API_BASE_URL}/tasks/${encodeURIComponent(gid)}`);
  url.searchParams.set("opt_fields", TASK_FIELDS);
  const payload = await requestAsana<AsanaResponse<AsanaTask>>(url.toString(), token);
  return payload.data || null;
}

async function toAsanaTaskItem(token: string, task: AsanaTask & { gid: string }, includeConversation: boolean): Promise<AsanaTaskItem> {
  const stories = includeConversation ? await listStories(token, task.gid) : [];
  const projects = (task.projects || task.memberships?.map((membership) => membership.project).filter(Boolean) || [])
    .map((project) => project?.name || project?.gid || "")
    .filter(Boolean);
  return {
    id: task.gid,
    gid: task.gid,
    title: task.name || "Untitled Asana task",
    url: task.permalink_url || `https://app.asana.com/0/0/${task.gid}`,
    completed: task.completed === true,
    state: task.completed === true ? "completed" : "open",
    labels: (task.tags || []).map((tag) => tag.name || "").filter(Boolean),
    assignees: task.assignee?.name ? [task.assignee.name] : [],
    bodyMarkdown: normalizeMarkdown(task.notes || ""),
    conversationMarkdown: formatStoriesMarkdown(stories),
    createdAt: task.created_at || null,
    updatedAt: task.modified_at || task.completed_at || null,
    issueAuthor: task.created_by?.name || null,
    metadata: {
      gid: task.gid,
      projects,
      sections: (task.memberships || []).map((membership) => membership.section?.name || "").filter(Boolean),
    },
  };
}

async function listStories(token: string, gid: string): Promise<AsanaStory[]> {
  const url = new URL(`${ASANA_API_BASE_URL}/tasks/${encodeURIComponent(gid)}/stories`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("opt_fields", "gid,type,text,created_at,created_by.name");
  const payload = await requestAsana<AsanaListResponse<AsanaStory>>(url.toString(), token);
  return (payload.data || []).filter((story) => story.type === "comment" && Boolean(story.text?.trim()));
}

async function requestAsana<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Asana API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return await response.json() as T;
}

function formatStoriesMarkdown(stories: AsanaStory[]): string {
  return stories.map((story, index) => {
    const author = story.created_by?.name || "unknown";
    const body = normalizeMarkdown(story.text || "") || "_No comment body provided._";
    return `##### Comment ${index + 1} - @${author}${story.created_at ? ` - ${story.created_at}` : ""}\n\n${body}`;
  }).join("\n\n");
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
