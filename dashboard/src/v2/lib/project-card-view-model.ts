import type {
  ProjectCardActionDescriptor,
  ProjectCardDisplayValue,
  ProjectCardSourceBadge,
  ProjectCardTaskCompletion,
  ProjectCardViewModel,
  Source,
} from "../types.js";
import {
  translateDashboardMessage,
  type DashboardLocale,
  type DashboardMessageVariables,
  type DashboardTextMessageKey,
} from "../i18n/locales.js";
import { projectMessages } from "../i18n/messages/projects.js";

export const PROJECT_CARD_EMPTY_VALUE = "--";

const createProjectCardTimestampFormatter = (locale: DashboardLocale): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const PROJECT_PROVIDER_LABELS: Record<Source["gitProvider"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  local: "Local",
};

const projectText = (
  locale: DashboardLocale,
  key: DashboardTextMessageKey<typeof projectMessages>,
  variables?: DashboardMessageVariables,
): string => translateDashboardMessage(projectMessages, locale, key, variables);

export function formatProjectCardDisplayValue(value: string | null | undefined): ProjectCardDisplayValue {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return {
    value: trimmed.length > 0 ? trimmed : PROJECT_CARD_EMPTY_VALUE,
    isEmpty: trimmed.length === 0,
  };
}

export function formatProjectCardTimestamp(
  value: string | null | undefined,
  locale: DashboardLocale = "en",
): ProjectCardDisplayValue {
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
    value: createProjectCardTimestampFormatter(locale).format(parsed),
    isEmpty: false,
  };
}

export function getProjectCardProviderLabel(project: Source): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(PROJECT_PROVIDER_LABELS[project.gitProvider] || project.gitProvider);
}

export function getProjectCardHostLabel(project: Source): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.gitHostDomain);
}

export function getProjectCardGitUrl(project: Source): ProjectCardDisplayValue {
  if (project.repoUrl?.trim()) {
    return formatProjectCardDisplayValue(project.repoUrl);
  }
  if (project.sourceType === "git") {
    return formatProjectCardDisplayValue(project.sourceRef);
  }
  return formatProjectCardDisplayValue(null);
}

export function getProjectCardLocalDirectory(project: Source): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.baseDir);
}

export function getProjectCardBranch(project: Source): ProjectCardDisplayValue {
  // Prefer the project-scope configured target branch (settings override) over the
  // raw project row default, so the card reflects what sprints actually merge into.
  const scopedBranch = project.settingsOverrides?.git?.defaultBranch;
  if (typeof scopedBranch === "string" && scopedBranch.trim().length > 0) {
    return formatProjectCardDisplayValue(scopedBranch);
  }
  return formatProjectCardDisplayValue(project.defaultBranch);
}

export function getProjectCardFeatureBranchPrefix(project: Source): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.featureBranchPrefix);
}

export function getProjectCardLastRunStatus(project: Source): ProjectCardDisplayValue {
  return formatProjectCardDisplayValue(project.lastRunStatus);
}

export function getProjectCardSourceBadge(
  project: Source,
  locale: DashboardLocale = "en",
): ProjectCardSourceBadge {
  if (project.sourceType === "git") {
    return {
      kind: "remote-git",
      label: projectText(locale, "remoteGit"),
      description: buildSourceDescription("remote-git", project, locale),
    };
  }

  if (project.repoUrl?.trim()) {
    return {
      kind: "local-repository",
      label: projectText(locale, "localRepository"),
      description: buildSourceDescription("local-repository", project, locale),
    };
  }

  return {
    kind: "local",
    label: projectText(locale, "local"),
    description: buildSourceDescription("local", project, locale),
  };
}

export function getProjectCardTaskCompletion(
  project: Source,
  locale: DashboardLocale = "en",
): ProjectCardTaskCompletion {
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
    value: new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(percentage / 100),
    percentage,
    completedTasks,
    openTasks,
    totalTasks,
    isEmpty: false,
  };
}

export function buildProjectCardActions(locale: DashboardLocale = "en"): ProjectCardActionDescriptor[] {
  return [
    {
      kind: "open-project",
      label: projectText(locale, "openAction"),
      ariaLabel: projectText(locale, "openProject"),
      title: projectText(locale, "openProject"),
      tone: "default",
    },
    {
      kind: "setup-project",
      label: projectText(locale, "setupProject"),
      ariaLabel: projectText(locale, "setupProject"),
      title: projectText(locale, "setupProject"),
      tone: "default",
    },
    {
      kind: "settings",
      label: projectText(locale, "settings"),
      ariaLabel: projectText(locale, "projectSettings"),
      title: projectText(locale, "projectSettings"),
      tone: "default",
    },
    {
      kind: "delete",
      label: projectText(locale, "delete"),
      ariaLabel: projectText(locale, "deleteProject"),
      title: projectText(locale, "deleteProject"),
      tone: "danger",
    },
  ];
}

export function buildProjectCardViewModel(
  project: Source,
  locale: DashboardLocale = "en",
): ProjectCardViewModel {
  return {
    sourceBadge: getProjectCardSourceBadge(project, locale),
    sourceTypeLabel: project.sourceType === "git"
      ? projectText(locale, "remoteGit")
      : project.repoUrl?.trim()
        ? projectText(locale, "localRepository")
        : projectText(locale, "local"),
    providerLabel: getProjectCardProviderLabel(project),
    hostLabel: getProjectCardHostLabel(project),
    gitUrl: getProjectCardGitUrl(project),
    localDirectory: getProjectCardLocalDirectory(project),
    createdAt: formatProjectCardTimestamp(project.createdAt, locale),
    updatedAt: formatProjectCardTimestamp(project.updatedAt, locale),
    lastRunAt: formatProjectCardTimestamp(project.lastRunAt, locale),
    lastRunStatus: getProjectCardLastRunStatus(project),
    branch: getProjectCardBranch(project),
    featureBranchPrefix: getProjectCardFeatureBranchPrefix(project),
    taskCompletion: getProjectCardTaskCompletion(project, locale),
    emptyValue: PROJECT_CARD_EMPTY_VALUE,
    actions: buildProjectCardActions(locale),
  };
}

function buildSourceDescription(
  kind: ProjectCardSourceBadge["kind"],
  project: Source,
  locale: DashboardLocale,
): string {
  const provider = getProjectCardProviderLabel(project).value;
  const host = project.gitHostDomain?.trim() || PROJECT_CARD_EMPTY_VALUE;

  if (kind === "local") {
    return projectText(locale, "localProjectDescription", {
      path: project.baseDir || PROJECT_CARD_EMPTY_VALUE,
    });
  }

  if (kind === "local-repository") {
    return projectText(locale, "localRepositoryDescription", { provider, host });
  }

  return projectText(locale, "remoteRepositoryDescription", { provider, host });
}
