import type { ProviderId } from "../../contracts/app-types.js";
import type { SprintRecord } from "../../contracts/project-management-types.js";

export const DEFAULT_TASK_PR_TITLE_SCHEME = "({sprint_tag}) {task_title}";

export interface TaskPrTitleSprintMetadata {
  id?: string | null;
  number?: number | null;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  linkedIssues?: Array<{ issueKey?: string | null }> | null;
}

export interface TaskPrTitleTaskMetadata {
  id?: string | null;
  taskKey?: string | null;
  title?: string | null;
}

export interface FormatTaskPrTitleInput {
  scheme?: string | null;
  sprintKeyPrefix: string;
  sprint?: TaskPrTitleSprintMetadata | SprintRecord | null;
  task: TaskPrTitleTaskMetadata;
  provider?: ProviderId | string | null;
}

const TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

const collapseTitleWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const firstNonEmpty = (...values: Array<string | number | null | undefined>): string => {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const normalized = collapseTitleWhitespace(String(value));
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return "";
};

const safeTaskTitle = (task: TaskPrTitleTaskMetadata): string => (
  firstNonEmpty(task.title, task.taskKey, task.id, "Task")
);

export const resolveTaskPrSprintTag = (
  sprint: TaskPrTitleSprintMetadata | SprintRecord | null | undefined,
  sprintKeyPrefix: string,
): string => {
  const linkedIssueKey = sprint?.linkedIssues
    ?.map((issue) => firstNonEmpty(issue.issueKey))
    .find((issueKey) => issueKey.length > 0);
  if (linkedIssueKey) {
    return linkedIssueKey;
  }

  if (typeof sprint?.number === "number" && Number.isFinite(sprint.number)) {
    const prefix = firstNonEmpty(sprintKeyPrefix, "SPR").toUpperCase();
    return `${prefix}-${sprint.number}`;
  }

  return firstNonEmpty(sprint?.slug, sprint?.id, "sprint");
};

export const formatTaskPrTitle = (input: FormatTaskPrTitleInput): string => {
  const taskTitle = safeTaskTitle(input.task);
  const sprint = input.sprint ?? null;
  const sprintTitle = sprint && "title" in sprint ? sprint.title : undefined;
  const sprintNumber = typeof sprint?.number === "number" && Number.isFinite(sprint.number)
    ? String(sprint.number)
    : "";
  const sprintTag = resolveTaskPrSprintTag(sprint, input.sprintKeyPrefix);
  const tokens: Record<string, string> = {
    sprint_tag: sprintTag,
    sprint_key: sprintNumber ? `${firstNonEmpty(input.sprintKeyPrefix, "SPR").toUpperCase()}-${sprintNumber}` : sprintTag,
    sprint_number: sprintNumber,
    sprint_title: firstNonEmpty(sprintTitle, sprint?.name, sprint?.slug, sprint?.id),
    task_key: firstNonEmpty(input.task.taskKey, input.task.id),
    task_title: taskTitle,
    provider: firstNonEmpty(input.provider),
  };
  const scheme = typeof input.scheme === "string" ? input.scheme : DEFAULT_TASK_PR_TITLE_SCHEME;
  const rendered = scheme.replace(TOKEN_PATTERN, (match, tokenName: string) => tokens[tokenName] ?? match);
  const title = collapseTitleWhitespace(rendered);
  return title.length > 0 ? title : taskTitle;
};
