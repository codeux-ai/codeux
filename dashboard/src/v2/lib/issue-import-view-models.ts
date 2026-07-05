export type IssueImportProvider = "github" | "gitlab" | "jira";

export type IssueImportProviderIcon = "github" | "gitlab" | "jira";

export interface IssueImportProviderAccent {
  badgeClassName: string;
  selectedCardClassName: string;
  selectedIconClassName: string;
  focusRingClassName: string;
}

export interface IssueImportProviderMetadata {
  provider: IssueImportProvider;
  label: string;
  importLabel: string;
  icon: IssueImportProviderIcon;
  accent: IssueImportProviderAccent;
}

export interface IssueImportMetadataSource {
  provider: IssueImportProvider;
  repository?: string | null;
  projectKey?: string | null;
  issueKey?: string | null;
  issueNumber?: number | null;
  state?: string | null;
  issueType?: string | null;
  priority?: string | null;
  issueAuthor?: string | null;
  issueReporter?: string | null;
  issueMilestone?: string | null;
  issueCommentCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface IssueImportMetadataRow {
  id: string;
  label: string;
  value: string;
}

export interface IssueImportTruncatedList {
  visible: string[];
  overflowCount: number;
  overflowLabel: string | null;
}

export interface IssueImportEmptyStateCopy {
  title: string;
  description: string;
}

export interface IssueImportErrorCopy {
  title: string;
  message: string;
}

const PROVIDER_METADATA: Record<IssueImportProvider, IssueImportProviderMetadata> = {
  github: {
    provider: "github",
    label: "GitHub",
    importLabel: "GitHub issue import",
    icon: "github",
    accent: {
      badgeClassName: "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300",
      selectedCardClassName: "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_14px_32px_rgba(0,224,160,0.08)] dark:border-signal-400/25 dark:bg-signal-400/[0.1]",
      selectedIconClassName: "bg-signal-500 text-white dark:text-void-950",
      focusRingClassName: "focus-visible:ring-signal-500/30",
    },
  },
  gitlab: {
    provider: "gitlab",
    label: "GitLab",
    importLabel: "GitLab issue import",
    icon: "gitlab",
    accent: {
      badgeClassName: "border-ember-500/20 bg-ember-500/10 text-ember-600 dark:text-ember-400",
      selectedCardClassName: "border-ember-500/30 bg-ember-500/[0.08] shadow-[0_14px_32px_rgba(255,184,0,0.08)] dark:border-ember-400/25 dark:bg-ember-400/[0.1]",
      selectedIconClassName: "bg-ember-500 text-slate-950",
      focusRingClassName: "focus-visible:ring-ember-500/30",
    },
  },
  jira: {
    provider: "jira",
    label: "Jira",
    importLabel: "Jira issue import",
    icon: "jira",
    accent: {
      badgeClassName: "border-[#4C9AFF]/25 bg-[#4C9AFF]/10 text-[#0052CC] dark:text-[#9ecbff]",
      selectedCardClassName: "border-[#0052CC]/35 bg-[#0052CC]/[0.08] shadow-[0_14px_32px_rgba(0,82,204,0.08)] dark:border-[#4C9AFF]/35 dark:bg-[#4C9AFF]/[0.12]",
      selectedIconClassName: "bg-[#0052CC] text-white dark:bg-[#4C9AFF] dark:text-slate-950",
      focusRingClassName: "focus-visible:ring-[#0052CC]/30",
    },
  },
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const formatDateTime = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return DATE_FORMATTER.format(parsed);
};

const formatState = (value: string | null | undefined): string => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Unknown";
  }
  return normalized.replace(/[_-]+/g, " ");
};

const addMetadataRow = (
  rows: IssueImportMetadataRow[],
  id: string,
  label: string,
  value: string | null | undefined,
): void => {
  const normalized = normalizeText(value);
  if (normalized) {
    rows.push({ id, label, value: normalized });
  }
};

export const getIssueImportProviderMetadata = (
  provider: IssueImportProvider,
  accentOverride?: Partial<IssueImportProviderAccent>,
): IssueImportProviderMetadata => {
  const metadata = PROVIDER_METADATA[provider];
  return {
    ...metadata,
    accent: {
      ...metadata.accent,
      ...accentOverride,
    },
  };
};

export const getSelectedIssueCountLabel = (
  selectedCount: number,
  linkedCount?: number,
  specialTaskCount?: number,
): string => {
  if (selectedCount <= 0) {
    return "No issues selected.";
  }

  const issueNoun = selectedCount === 1 ? "issue" : "issues";
  if (linkedCount === undefined && specialTaskCount === undefined) {
    return `${selectedCount} selected ${issueNoun} will be imported.`;
  }

  const linked = Math.max(0, linkedCount ?? selectedCount - (specialTaskCount ?? 0));
  const special = Math.max(0, specialTaskCount ?? selectedCount - linked);
  const specialNoun = special === 1 ? "task" : "tasks";
  return `${selectedCount} selected ${issueNoun} will be imported. ${linked} linked, ${special} special ${specialNoun}.`;
};

export const buildIssueImportMetadataRows = (source: IssueImportMetadataSource): IssueImportMetadataRow[] => {
  const rows: IssueImportMetadataRow[] = [];
  const provider = getIssueImportProviderMetadata(source.provider);
  const issueRef = normalizeText(source.issueKey) ?? (source.issueNumber ? `#${source.issueNumber}` : null);

  addMetadataRow(rows, "provider", "Provider", provider.label);
  addMetadataRow(rows, "repository", source.provider === "jira" ? "Project" : "Repository", normalizeText(source.projectKey) ?? source.repository);
  addMetadataRow(rows, "issue", "Issue", issueRef);
  addMetadataRow(rows, "state", "State", formatState(source.state));
  addMetadataRow(rows, "type", "Type", source.issueType);
  addMetadataRow(rows, "priority", "Priority", source.priority);
  addMetadataRow(rows, "author", "Author", source.issueAuthor);
  addMetadataRow(rows, "reporter", "Reporter", source.issueReporter);
  addMetadataRow(rows, "milestone", "Milestone", source.issueMilestone);
  if (typeof source.issueCommentCount === "number") {
    rows.push({
      id: "comments",
      label: "Comments",
      value: String(Math.max(0, source.issueCommentCount)),
    });
  }
  addMetadataRow(rows, "created", "Created", formatDateTime(source.createdAt));
  addMetadataRow(rows, "updated", "Updated", formatDateTime(source.updatedAt));

  return rows;
};

export const truncateIssueImportList = (
  values: ReadonlyArray<string | null | undefined>,
  maxVisible = 6,
): IssueImportTruncatedList => {
  const uniqueValues = values.reduce<string[]>((items, value) => {
    const normalized = normalizeText(value);
    if (normalized && !items.includes(normalized)) {
      items.push(normalized);
    }
    return items;
  }, []);
  const limit = Math.max(0, Math.trunc(maxVisible));
  const visible = uniqueValues.slice(0, limit);
  const overflowCount = Math.max(0, uniqueValues.length - visible.length);

  return {
    visible,
    overflowCount,
    overflowLabel: overflowCount > 0 ? `+${overflowCount} more` : null,
  };
};

export const truncateIssueImportLabels = (
  labels: ReadonlyArray<string | null | undefined>,
  maxVisible = 6,
): IssueImportTruncatedList => truncateIssueImportList(labels, maxVisible);

export const truncateIssueImportAssignees = (
  assignees: ReadonlyArray<string | null | undefined>,
  maxVisible = 4,
): IssueImportTruncatedList => truncateIssueImportList(assignees, maxVisible);

export const getIssueImportEmptyStateCopy = (
  provider: IssueImportProvider,
  hasSearched: boolean,
): IssueImportEmptyStateCopy => {
  const providerLabel = getIssueImportProviderMetadata(provider).label;
  if (!hasSearched) {
    return {
      title: `Search ${providerLabel} issues`,
      description: "Choose filters and run a search to preview importable sprint context.",
    };
  }
  return {
    title: `No ${providerLabel} issues found`,
    description: "Adjust the filters, broaden the repository scope, or search for an exact issue key.",
  };
};

export const getIssueImportErrorCopy = (
  error: unknown,
  fallbackMessage = "The issue search could not be completed. Check the filters and try again.",
): IssueImportErrorCopy => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallbackMessage;
  return {
    title: "Issue import failed",
    message: normalizeText(message) ?? fallbackMessage,
  };
};
