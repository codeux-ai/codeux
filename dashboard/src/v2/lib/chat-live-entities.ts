import type {
  ChatMessageRecord,
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
  Sprint,
  Task,
} from "../types.js";

export type ChatLiveEntityKind = "sprint" | "task";

interface BaseChatLiveEntityWidget {
  kind: ChatLiveEntityKind;
  recordId: string;
  displayKey: string;
  name: string;
  status: string;
  href: string;
}

export interface ChatLiveSprintWidget extends BaseChatLiveEntityWidget {
  kind: "sprint";
  sprintNumber: number | null;
  tasksCount: number;
  completedTasks: number;
  completion: number;
}

export interface ChatLiveTaskWidget extends BaseChatLiveEntityWidget {
  kind: "task";
  sprintId: string;
  sprintKey: string | null;
  sprintName: string | null;
  priority: Task["priority"];
  executorType: Task["executorType"];
  isMerged: boolean;
  mergeIndicator: string | null;
}

export type ChatLiveEntityWidget = ChatLiveSprintWidget | ChatLiveTaskWidget;

export interface ResolveChatLiveEntitiesInput {
  sprints?: readonly Sprint[] | null;
  tasks?: readonly Task[] | null;
  sprintKeyPrefix: string;
  message?: ChatMessageRecord | ExecutionInvocationMessageRecord | null;
  invocation?: ExecutionInvocationRecord | null;
  bodyMarkdown?: string | null;
  contentMarkdown?: string | null;
}

interface EntityIndexes {
  sprintById: Map<string, Sprint>;
  sprintByKey: Map<string, Sprint>;
  sprintByNumber: Map<number, Sprint>;
  sprintByName: Map<string, Sprint>;
  tasksByRecordId: Map<string, Task>;
  tasksByKey: Map<string, Task[]>;
  tasksByTitle: Map<string, Task[]>;
}

interface EntityAccumulator {
  widgets: ChatLiveEntityWidget[];
  seen: Set<string>;
  contextSprintIds: string[];
}

interface ReferenceContext {
  sprintId?: string | null;
  sprintKey?: string | null;
  sprintNumber?: number | null;
  sprintName?: string | null;
}

const DASHBOARD_LINK_FALLBACK_ORIGIN = "http://codeux.local";
const DEFAULT_SPRINT_KEY_PREFIX = "SPR";
const COMPLETED_TASK_STATUSES = new Set<Task["status"]>(["completed"]);

export function resolveChatLiveEntities(input: ResolveChatLiveEntitiesInput): ChatLiveEntityWidget[] {
  const sprints = input.sprints ?? [];
  const tasks = input.tasks ?? [];
  if (sprints.length === 0 && tasks.length === 0) {
    return [];
  }

  const sprintKeyPrefix = normalizeString(input.sprintKeyPrefix) ?? DEFAULT_SPRINT_KEY_PREFIX;
  const indexes = buildIndexes(sprints, tasks, sprintKeyPrefix);
  const accumulator: EntityAccumulator = { widgets: [], seen: new Set(), contextSprintIds: [] };
  const metadata = readRecord(input.message?.metadata);
  const widgetMetadata = readRecord(metadata?.widget_metadata);
  const markdown = collectMarkdown(input);

  const metadataContexts = [metadata, widgetMetadata]
    .filter((record): record is Record<string, unknown> => record !== null)
    .map(readReferenceContext);
  const invocationContext = readInvocationContext(input.invocation);

  for (const context of [...metadataContexts, invocationContext]) {
    resolveExplicitIds(context, indexes, accumulator, sprintKeyPrefix);
  }

  const explicitSprintContext = getSingleContextSprintId(accumulator.contextSprintIds);
  for (const context of [...metadataContexts, invocationContext]) {
    resolveKeyReferences(context, indexes, accumulator, sprintKeyPrefix, explicitSprintContext);
  }

  const textSprintContext = getSingleContextSprintId(accumulator.contextSprintIds);
  resolveMarkdownKeys(stripDashboardLinkDestinations(markdown), indexes, accumulator, sprintKeyPrefix, textSprintContext);
  resolveDashboardLinks(markdown, indexes, accumulator, sprintKeyPrefix);

  return accumulator.widgets;
}

function buildIndexes(sprints: readonly Sprint[], tasks: readonly Task[], sprintKeyPrefix: string): EntityIndexes {
  const sprintById = new Map<string, Sprint>();
  const sprintByKey = new Map<string, Sprint>();
  const sprintByNumber = new Map<number, Sprint>();
  const sprintByName = new Map<string, Sprint>();
  for (const sprint of sprints) {
    sprintById.set(sprint.id, sprint);
    const sprintKey = getSprintDisplayKey(sprint, sprintKeyPrefix);
    sprintByKey.set(normalizeKey(sprintKey), sprint);
    if (sprint.number !== null) {
      sprintByNumber.set(sprint.number, sprint);
    }
    const sprintName = normalizeKey(sprint.name);
    if (sprintName) {
      sprintByName.set(sprintName, sprint);
    }
  }

  const tasksByRecordId = new Map<string, Task>();
  const tasksByKey = new Map<string, Task[]>();
  const tasksByTitle = new Map<string, Task[]>();
  for (const task of tasks) {
    tasksByRecordId.set(task.recordId, task);
    pushMapValue(tasksByKey, normalizeKey(task.id), task);
    pushMapValue(tasksByTitle, normalizeKey(task.title), task);
  }

  return {
    sprintById,
    sprintByKey,
    sprintByNumber,
    sprintByName,
    tasksByRecordId,
    tasksByKey,
    tasksByTitle,
  };
}

function resolveExplicitIds(
  context: ReferenceContext & { taskId?: string | null },
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
): void {
  const sprint = context.sprintId ? indexes.sprintById.get(context.sprintId) ?? null : null;
  if (sprint) {
    addSprintWidget(sprint, indexes, accumulator, sprintKeyPrefix);
  } else if (context.sprintId) {
    return;
  }

  if (context.taskId) {
    const task = indexes.tasksByRecordId.get(context.taskId);
    if (task && (!sprint || task.sprintId === sprint.id)) {
      addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
    }
  }
}

function resolveKeyReferences(
  context: ReferenceContext & { taskKey?: string | null; taskTitle?: string | null },
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
  fallbackSprintId: string | null,
): void {
  const sprint = resolveSprintFromContext(context, indexes, sprintKeyPrefix);
  if (sprint) {
    addSprintWidget(sprint, indexes, accumulator, sprintKeyPrefix);
  } else if (hasSprintReference(context)) {
    return;
  }

  const sprintId = sprint?.id ?? fallbackSprintId;
  if (context.taskKey) {
    const task = resolveTaskByKey(context.taskKey, indexes, sprintId);
    if (task) {
      addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
    }
  }

  if (context.taskTitle) {
    const task = resolveTaskByTitle(context.taskTitle, indexes, sprintId);
    if (task) {
      addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
    }
  }
}

function resolveMarkdownKeys(
  markdown: string,
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
  sprintContextId: string | null,
): void {
  if (!markdown.trim()) {
    return;
  }

  for (const sprint of indexes.sprintById.values()) {
    const sprintKey = getSprintDisplayKey(sprint, sprintKeyPrefix);
    if (containsToken(markdown, sprintKey)) {
      addSprintWidget(sprint, indexes, accumulator, sprintKeyPrefix);
    }
  }

  const resolvedSprintContext = getSingleContextSprintId(accumulator.contextSprintIds) ?? sprintContextId;
  for (const taskKey of indexes.tasksByKey.keys()) {
    if (!taskKey || !containsToken(markdown, taskKey)) {
      continue;
    }
    const task = resolveTaskByKey(taskKey, indexes, resolvedSprintContext);
    if (task) {
      addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
    }
  }
}

function resolveDashboardLinks(
  markdown: string,
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
): void {
  for (const href of extractDashboardLinkCandidates(markdown)) {
    const url = parseDashboardUrl(href);
    if (!url) {
      continue;
    }

    if (url.pathname === "/sprints") {
      const sprint = resolveSprintFromContext(readLinkContext(url.searchParams), indexes, sprintKeyPrefix);
      if (sprint) {
        addSprintWidget(sprint, indexes, accumulator, sprintKeyPrefix);
      }
      continue;
    }

    if (url.pathname === "/tasks") {
      const context = readLinkContext(url.searchParams);
      const sprint = resolveSprintFromContext(context, indexes, sprintKeyPrefix);
      if (!sprint && hasSprintReference(context)) {
        continue;
      }
      const taskId = normalizeString(url.searchParams.get("taskId") ?? url.searchParams.get("task_id"));
      const taskKey = normalizeString(url.searchParams.get("taskKey") ?? url.searchParams.get("task_key"));
      if (taskId) {
        const task = indexes.tasksByRecordId.get(taskId);
        if (task && (!sprint || task.sprintId === sprint.id)) {
          addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
        }
      } else if (taskKey) {
        const task = resolveTaskByKey(taskKey, indexes, sprint?.id ?? null);
        if (task) {
          addTaskWidget(task, indexes, accumulator, sprintKeyPrefix);
        }
      }
    }
  }
}

function addSprintWidget(
  sprint: Sprint,
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
): void {
  accumulator.contextSprintIds.push(sprint.id);
  const seenKey = `sprint:${sprint.id}`;
  if (accumulator.seen.has(seenKey)) {
    return;
  }
  accumulator.seen.add(seenKey);

  const sprintTasks = Array.from(indexes.tasksByRecordId.values()).filter((task) => task.sprintId === sprint.id);
  const tasksCount = sprintTasks.length > 0 ? sprintTasks.length : sprint.tasksCount;
  const completedTasks = sprintTasks.filter((task) => COMPLETED_TASK_STATUSES.has(task.status)).length;
  const displayKey = getSprintDisplayKey(sprint, sprintKeyPrefix);
  accumulator.widgets.push({
    kind: "sprint",
    recordId: sprint.id,
    displayKey,
    name: sprint.name,
    status: sprint.status,
    href: buildSprintHref(sprint, sprintKeyPrefix),
    sprintNumber: sprint.number,
    tasksCount,
    completedTasks,
    completion: sprint.completion,
  });
}

function addTaskWidget(
  task: Task,
  indexes: EntityIndexes,
  accumulator: EntityAccumulator,
  sprintKeyPrefix: string,
): void {
  const seenKey = `task:${task.recordId}`;
  if (accumulator.seen.has(seenKey)) {
    return;
  }
  accumulator.seen.add(seenKey);

  const sprint = indexes.sprintById.get(task.sprintId) ?? null;
  accumulator.widgets.push({
    kind: "task",
    recordId: task.recordId,
    displayKey: task.id,
    name: task.title,
    status: task.status,
    href: `/tasks?sprintId=${encodeURIComponent(task.sprintId)}&taskId=${encodeURIComponent(task.recordId)}`,
    sprintId: task.sprintId,
    sprintKey: sprint ? getSprintDisplayKey(sprint, sprintKeyPrefix) : null,
    sprintName: sprint?.name ?? task.sprint ?? null,
    priority: task.priority,
    executorType: task.executorType,
    isMerged: task.isMerged,
    mergeIndicator: task.mergeIndicator,
  });
}

function resolveSprintFromContext(
  context: ReferenceContext,
  indexes: EntityIndexes,
  sprintKeyPrefix: string,
): Sprint | null {
  if (context.sprintId) {
    return indexes.sprintById.get(context.sprintId) ?? null;
  }
  if (context.sprintKey) {
    const sprint = indexes.sprintByKey.get(normalizeKey(context.sprintKey));
    if (sprint) {
      return sprint;
    }
  }
  if (typeof context.sprintNumber === "number") {
    const sprint = indexes.sprintByNumber.get(context.sprintNumber);
    if (sprint) {
      return sprint;
    }
  }
  if (context.sprintName) {
    const sprint = indexes.sprintByName.get(normalizeKey(context.sprintName));
    if (sprint) {
      return sprint;
    }
    const inferredNumber = readSprintNumberFromKey(context.sprintName, sprintKeyPrefix);
    return inferredNumber !== null ? indexes.sprintByNumber.get(inferredNumber) ?? null : null;
  }
  return null;
}

function resolveTaskByKey(taskKey: string, indexes: EntityIndexes, sprintContextId: string | null): Task | null {
  const candidates = indexes.tasksByKey.get(normalizeKey(taskKey)) ?? [];
  if (candidates.length === 0) {
    return null;
  }
  if (sprintContextId) {
    return candidates.find((task) => task.sprintId === sprintContextId) ?? null;
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function resolveTaskByTitle(taskTitle: string, indexes: EntityIndexes, sprintContextId: string | null): Task | null {
  const candidates = indexes.tasksByTitle.get(normalizeKey(taskTitle)) ?? [];
  if (candidates.length === 0) {
    return null;
  }
  if (sprintContextId) {
    return candidates.find((task) => task.sprintId === sprintContextId) ?? null;
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function hasSprintReference(context: ReferenceContext): boolean {
  return Boolean(
    context.sprintId
    || context.sprintKey
    || typeof context.sprintNumber === "number"
    || context.sprintName,
  );
}

function readReferenceContext(record: Record<string, unknown>): ReferenceContext & {
  taskId?: string | null;
  taskKey?: string | null;
  taskTitle?: string | null;
} {
  return {
    sprintId: readFirstString(record.sprintId, record.sprint_id),
    taskId: readFirstString(record.taskId, record.task_id),
    sprintKey: readFirstString(record.sprintKey, record.sprint_key),
    taskKey: readFirstString(record.taskKey, record.task_key),
    sprintNumber: readFirstNumber(record.sprintNumber, record.sprint_number),
    sprintName: readFirstString(record.sprintName, record.sprint_name),
    taskTitle: readFirstString(record.taskTitle, record.task_title),
  };
}

function readInvocationContext(invocation: ExecutionInvocationRecord | null | undefined): ReferenceContext & {
  taskId?: string | null;
  taskKey?: string | null;
  taskTitle?: string | null;
} {
  return {
    sprintId: invocation?.sprintId ?? null,
    taskId: invocation?.taskId ?? null,
    sprintNumber: invocation?.sprintNumber ?? null,
    sprintName: invocation?.sprintName ?? null,
    taskKey: invocation?.taskKey ?? null,
    taskTitle: invocation?.taskTitle ?? null,
  };
}

function readLinkContext(searchParams: URLSearchParams): ReferenceContext {
  return {
    sprintId: normalizeString(searchParams.get("sprintId") ?? searchParams.get("sprint_id")),
    sprintKey: normalizeString(searchParams.get("sprintKey") ?? searchParams.get("sprint_key")),
    sprintNumber: readFirstNumber(searchParams.get("sprintNumber"), searchParams.get("sprint_number")),
    sprintName: normalizeString(searchParams.get("sprintName") ?? searchParams.get("sprint_name")),
  };
}

function collectMarkdown(input: ResolveChatLiveEntitiesInput): string {
  const values = [
    input.bodyMarkdown,
    input.contentMarkdown,
    "bodyMarkdown" in (input.message ?? {}) ? (input.message as ChatMessageRecord).bodyMarkdown : null,
    "contentMarkdown" in (input.message ?? {}) ? (input.message as ExecutionInvocationMessageRecord).contentMarkdown : null,
  ];
  return values
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join("\n");
}

function extractDashboardLinkCandidates(markdown: string): string[] {
  const candidates = new Set<string>();
  const markdownLinkPattern = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of markdown.matchAll(markdownLinkPattern)) {
    const href = normalizeString(match[1]);
    if (href) {
      candidates.add(stripTrailingPunctuation(href));
    }
  }

  const plainLinkPattern = /(?:^|[\s(<])((?:https?:\/\/[^\s)\]]+|\/(?:sprints|tasks)\?[^\s)\]]+))/g;
  for (const match of markdown.matchAll(plainLinkPattern)) {
    const href = normalizeString(match[1]);
    if (href) {
      candidates.add(stripTrailingPunctuation(href));
    }
  }
  return [...candidates];
}

function parseDashboardUrl(href: string): URL | null {
  try {
    const isOriginQualified = /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(href) || href.startsWith("//");
    const dashboardOrigin = getDashboardLinkOrigin();
    const url = new URL(href, dashboardOrigin);
    if (isOriginQualified && url.origin !== dashboardOrigin) {
      return null;
    }
    return url.pathname === "/sprints" || url.pathname === "/tasks" ? url : null;
  } catch {
    return null;
  }
}

function getDashboardLinkOrigin(): string {
  const runtimeOrigin = typeof globalThis.location?.origin === "string" ? globalThis.location.origin : "";
  return normalizeOrigin(runtimeOrigin) ?? DASHBOARD_LINK_FALLBACK_ORIGIN;
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function stripDashboardLinkDestinations(markdown: string): string {
  let stripped = markdown;
  for (const href of extractDashboardLinkCandidates(markdown)) {
    stripped = stripped.replace(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ");
  }
  return stripped;
}

function getSprintDisplayKey(sprint: Sprint, sprintKeyPrefix: string): string {
  return sprint.number !== null ? `${sprintKeyPrefix}-${sprint.number}` : sprint.slug || sprint.id;
}

function buildSprintHref(sprint: Sprint, sprintKeyPrefix: string): string {
  const params = new URLSearchParams();
  params.set("sprintId", sprint.id);
  if (sprint.number !== null) {
    params.set("sprintKey", getSprintDisplayKey(sprint, sprintKeyPrefix));
  }
  return `/sprints?${params.toString()}`;
}

function containsToken(text: string, token: string): boolean {
  if (!token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, "i").test(text);
}

function getSingleContextSprintId(sprintIds: readonly string[]): string | null {
  const unique = new Set(sprintIds);
  return unique.size === 1 ? [...unique][0] ?? null : null;
}

function readSprintNumberFromKey(value: string, sprintKeyPrefix: string): number | null {
  const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.trim().match(new RegExp(`^${prefixEscaped}-(\\d+)\\b`, "i"));
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = normalizeString(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return null;
}

function readFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const stringValue = normalizeString(value);
    if (stringValue && /^\d+$/.test(stringValue)) {
      return Number.parseInt(stringValue, 10);
    }
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function pushMapValue<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:]+$/g, "");
}
