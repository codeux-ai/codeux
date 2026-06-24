import type {
  ProjectCardActionDescriptor,
  ProjectCardDisplayValue,
  ProjectCardSourceBadge,
  ProjectCardTaskCompletion,
  ProjectCardViewModel,
} from "../types.js";
import type { ProjectSummary } from "../../../../src/contracts/project-management-types.js";

export const PROJECT_CARD_EMPTY_VALUE = "--";

const PROJECT_CARD_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const PROJECT_PROVIDER_LABELS: Record<ProjectSummary["gitProvider"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  local: "Local",
};

const PROJECT_CARD_ACTIONS: Array<Pick<ProjectCardActionDescriptor, "kind" | "label" | "ariaLabel" | "title" | "tone">> = [
  {
    kind: "open-project",
    label: "Open project",
    ariaLabel: "Open project",
    title: "Open project",
    tone: "default",
  },
  {
    kind: "settings",
    label: "Settings",
    ariaLabel: "Project settings",
    title: "Project settings",
    tone: "default",
  },
  {
    kind: "setup-agent",
    label: "Setup agent",
    ariaLabel: "Setup agent",
    title: "Setup agent",
    tone: "default",
  },
  {
    kind: "invocation",
    label: "Open invocation",
    ariaLabel: "Open invocation",
    title: "Open invocation",
    tone: "default",
  },
  {
    kind: "delete",
    label: "Delete project",
    ariaLabel: "Delete project",
    title: "Delete project",
    tone: "danger",
  },
];

export function formatProjectCardDisplayValue(value: string | null | undefined): ProjectCardDisplayValue {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return {
    value: trimmed.length > 0 ? trimmed : PROJECT_CARD_EMPTY_VALUE,
    isEmpty: trimmed.length === 0,
  };
}

export function formatProjectCardTimestamp(value: string | null | undefined): ProjectCardDisplayValue {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return {
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    };
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    };
  }

  return {
    value: PROJECT_CARD_TIMESTAMP_FORMATTER.format(parsed),
    isEmpty: false,
  };
}

export function getProjectCardProviderLabel(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(PROJECT_PROVIDER_LABELS[project.gitProvider] || project.gitProvider);
}

export function getProjectCardHostLabel(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.gitHostDomain);
}

export function getProjectCardGitUrl(project: ProjectSummary): ProjectCardDisplayValue {
  if (project.repoUrl?.trim()) {
    return formatProjectCardDisplayValue(project.repoUrl);
  }
  if (project.sourceType === "git") {
    return formatProjectCardDisplayValue(project.sourceRef);
  }
  return formatProjectCardDisplayValue(null);
}

export function getProjectCardLocalDirectory(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.baseDir);
}

export function getProjectCardBranch(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.defaultBranch);
}

export function getProjectCardFeatureBranchPrefix(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.featureBranchPrefix);
}

export function getProjectCardLastRunStatus(project: ProjectSummary): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.lastRunStatus);
}

export function getProjectCardSourceBadge(project: ProjectSummary): ProjectCardSourceBadge {
  if (project.sourceType === "git") {
    return {
      kind: "remote-git",
      label: "Remote Git",
      description: buildSourceDescription("remote-git", project),
    };
  }

  if (project.repoUrl?.trim()) {
    return {
      kind: "local-repository",
      label: "Local repo",
      description: buildSourceDescription("local-repository", project),
    };
  }

  return {
    kind: "local",
    label: "Local",
    description: buildSourceDescription("local", project),
  };
}

export function getProjectCardTaskCompletion(project: ProjectSummary): ProjectCardTaskCompletion {
  const completedTasks = Math.max(0, Math.trunc(project.completedTasks));
  const openTasks = Math.max(0, Math.trunc(project.openTasks));
  const totalTasks = completedTasks + openTasks;
  if (totalTasks <= 0) {
    return {
      value: PROJECT_CARD_EMPTY_VALUE,
      percentage: null,
      completedTasks,
      openTasks,
      totalTasks,
      isEmpty: true,
    };
  }

  const percentage = Math.round((completedTasks / totalTasks) * 100);
  return {
    value: `${percentage}%`,
    percentage,
    completedTasks,
    openTasks,
    totalTasks,
    isEmpty: false,
  };
}

export function buildProjectCardActions(): ProjectCardActionDescriptor[] {
  return PROJECT_CARD_ACTIONS.map((action) => ({ ...action }));
}

export function buildProjectCardViewModel(project: ProjectSummary): ProjectCardViewModel {
  return {
    sourceBadge: getProjectCardSourceBadge(project),
    sourceTypeLabel: project.sourceType === "git" ? "Remote Git" : project.repoUrl?.trim() ? "Local repo" : "Local",
    providerLabel: getProjectCardProviderLabel(project),
    hostLabel: getProjectCardHostLabel(project),
    gitUrl: getProjectCardGitUrl(project),
    localDirectory: getProjectCardLocalDirectory(project),
    createdAt: formatProjectCardTimestamp(project.createdAt),
    updatedAt: formatProjectCardTimestamp(project.updatedAt),
    lastRunAt: formatProjectCardTimestamp(project.lastRunAt),
    lastRunStatus: getProjectCardLastRunStatus(project),
    branch: getProjectCardBranch(project),
    featureBranchPrefix: getProjectCardFeatureBranchPrefix(project),
    taskCompletion: getProjectCardTaskCompletion(project),
    emptyValue: PROJECT_CARD_EMPTY_VALUE,
    actions: buildProjectCardActions(),
  };
}

function buildSourceDescription(kind: ProjectCardSourceBadge["kind"], project: ProjectSummary): string {
  const provider = getProjectCardProviderLabel(project).value;
  const host = project.gitHostDomain?.trim() || PROJECT_CARD_EMPTY_VALUE;

  if (kind === "local") {
    return `Local project rooted at ${project.baseDir || PROJECT_CARD_EMPTY_VALUE}.`;
  }

  if (kind === "local-repository") {
    return `Local project with inferred ${provider} origin on ${host}.`;
  }

  return `${provider} repository hosted on ${host}.`;
}
