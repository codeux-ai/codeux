export type IssueImportProvider = "github" | "gitlab" | "jira" | "notion" | "asana" | "linear";

export type IssueImportProviderIcon = "github" | "gitlab" | "jira" | "notion" | "asana" | "linear";

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
  sourceProvider?: string | null;
  sourceKind?: string | null;
  externalId?: string | null;
  repository?: string | null;
  workspaceId?: string | null;
  teamId?: string | null;
  teamKey?: string | null;
  databaseId?: string | null;
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

export type IssueImportFilterSummaryValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number | boolean | null | undefined>
  | null
  | undefined;

type IssueImportFilterSummaryArray = ReadonlyArray<string | number | boolean | null | undefined>;

export interface IssueImportFilterSummaryInput {
  id: string;
  label: string;
  value: IssueImportFilterSummaryValue;
  defaultValue?: IssueImportFilterSummaryValue;
  priority?: number;
  alwaysShow?: boolean;
  valueLabel?: string | null;
  defaultLabel?: string | null;
}

export interface IssueImportFilterSummaryChip {
  id: string;
  label: string;
  value: string;
  active: boolean;
}

export interface IssueImportCompactStateInput {
  filters?: ReadonlyArray<IssueImportFilterSummaryInput>;
  selectedCount?: number;
  visibleCount?: number;
  totalCount?: number;
  sortField?: string | null;
  sortDirection?: string | null;
  sortFieldOptions?: ReadonlyArray<{ value: string; label: string }>;
  sortDirectionOptions?: ReadonlyArray<{ value: string; label: string }>;
  resultNounSingular?: string;
  resultNounPlural?: string;
}

export interface IssueImportCompactState {
  chips: IssueImportFilterSummaryChip[];
  activeFilterCount: number;
  activeFilterCountLabel: string;
  sortLabel: string;
  selectedCountLabel: string;
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
  notion: {
    provider: "notion",
    label: "Notion",
    importLabel: "Notion scope import",
    icon: "notion",
    accent: {
      badgeClassName: "border-slate-900/10 bg-slate-900/[0.04] text-slate-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-white",
      selectedCardClassName: "border-slate-900/20 bg-slate-900/[0.055] shadow-[0_14px_32px_rgba(15,23,42,0.08)] dark:border-white/16 dark:bg-white/[0.08]",
      selectedIconClassName: "bg-slate-900 text-white dark:bg-white dark:text-slate-950",
      focusRingClassName: "focus-visible:ring-slate-900/20 dark:focus-visible:ring-white/20",
    },
  },
  asana: {
    provider: "asana",
    label: "Asana",
    importLabel: "Asana task import",
    icon: "asana",
    accent: {
      badgeClassName: "border-[#FC636B]/25 bg-[#FC636B]/10 text-[#B42334] dark:text-[#FDA4AF]",
      selectedCardClassName: "border-[#FC636B]/35 bg-[#FC636B]/[0.08] shadow-[0_14px_32px_rgba(252,99,107,0.08)] dark:border-[#FDA4AF]/30 dark:bg-[#FC636B]/[0.12]",
      selectedIconClassName: "bg-[#FC636B] text-white",
      focusRingClassName: "focus-visible:ring-[#FC636B]/30",
    },
  },
  linear: {
    provider: "linear",
    label: "Linear",
    importLabel: "Linear issue import",
    icon: "linear",
    accent: {
      badgeClassName: "border-[#5E6AD2]/25 bg-[#5E6AD2]/10 text-[#3F46A3] dark:text-[#B8BCF8]",
      selectedCardClassName: "border-[#5E6AD2]/35 bg-[#5E6AD2]/[0.08] shadow-[0_14px_32px_rgba(94,106,210,0.08)] dark:border-[#B8BCF8]/30 dark:bg-[#5E6AD2]/[0.12]",
      selectedIconClassName: "bg-[#5E6AD2] text-white",
      focusRingClassName: "focus-visible:ring-[#5E6AD2]/30",
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

const normalizeSummaryScalar = (value: string | number | boolean | null | undefined): string | null => {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return null;
};

const isSummaryArray = (value: IssueImportFilterSummaryValue): value is IssueImportFilterSummaryArray => (
  Array.isArray(value)
);

const normalizeSummaryValue = (value: IssueImportFilterSummaryValue): string | null => {
  if (isSummaryArray(value)) {
    const normalized = value
      .map((item) => normalizeSummaryScalar(item))
      .filter((item): item is string => item !== null);
    return normalized.length > 0 ? normalized.join(", ") : null;
  }
  return normalizeSummaryScalar(value);
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
  provider: IssueImportProvider | string | null | undefined,
  accentOverride?: Partial<IssueImportProviderAccent>,
): IssueImportProviderMetadata => {
  const metadata = provider === "gitlab"
    || provider === "jira"
    || provider === "github"
    || provider === "notion"
    || provider === "asana"
    || provider === "linear"
    ? PROVIDER_METADATA[provider]
    : PROVIDER_METADATA.github;
  return {
    ...metadata,
    accent: {
      ...metadata.accent,
      ...accentOverride,
    },
  };
};

export const getIssueImportActiveFilterCount = (
  filters: ReadonlyArray<IssueImportFilterSummaryInput>,
): number => filters.reduce((count, filter) => {
  const value = normalizeSummaryValue(filter.value);
  const defaultValue = normalizeSummaryValue(filter.defaultValue);
  const active = value !== null && value !== defaultValue;
  return active ? count + 1 : count;
}, 0);

export const buildIssueImportFilterSummaryChips = (
  filters: ReadonlyArray<IssueImportFilterSummaryInput>,
): IssueImportFilterSummaryChip[] => filters
  .map((filter, index) => {
    const value = normalizeSummaryValue(filter.value);
    const defaultValue = normalizeSummaryValue(filter.defaultValue);
    const active = value !== null && value !== defaultValue;
    const displayValue = normalizeText(filter.valueLabel ?? undefined)
      ?? value
      ?? normalizeText(filter.defaultLabel ?? undefined)
      ?? defaultValue;

    if (!displayValue || (!active && !filter.alwaysShow)) {
      return null;
    }

    return {
      chip: {
        id: normalizeText(filter.id) ?? `${filter.label}-${index}`,
        label: normalizeText(filter.label) ?? "Filter",
        value: displayValue,
        active,
      },
      index,
      priority: filter.priority ?? index,
    };
  })
  .filter((entry): entry is { chip: IssueImportFilterSummaryChip; index: number; priority: number } => entry !== null)
  .sort((left, right) => left.priority - right.priority || left.index - right.index)
  .map((entry) => entry.chip);

export const getIssueImportActiveFilterCountLabel = (activeFilterCount: number): string => {
  if (activeFilterCount <= 0) {
    return "No active filters";
  }
  return `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`;
};

export const getIssueImportDefaultSortLabel = (
  sortField?: string | null,
  sortDirection?: string | null,
  sortFieldOptions: ReadonlyArray<{ value: string; label: string }> = [],
  sortDirectionOptions: ReadonlyArray<{ value: string; label: string }> = [],
): string => {
  const normalizedField = normalizeText(sortField ?? undefined);
  const normalizedDirection = normalizeText(sortDirection ?? undefined);
  const fieldLabel = sortFieldOptions.find((option) => option.value === normalizedField)?.label
    ?? normalizedField
    ?? "Default";
  const directionLabel = sortDirectionOptions.find((option) => option.value === normalizedDirection)?.label
    ?? (normalizedDirection === "desc" ? "Newest first" : normalizedDirection === "asc" ? "Oldest first" : null);

  return directionLabel ? `${fieldLabel}, ${directionLabel}` : fieldLabel;
};

export const getIssueImportSelectedResultCountLabel = (
  selectedCount: number,
  visibleCount?: number,
  totalCount?: number,
  resultNounSingular = "issue",
  resultNounPlural = "issues",
): string => {
  const selected = Math.max(0, Math.trunc(selectedCount));
  const visible = typeof visibleCount === "number" ? Math.max(0, Math.trunc(visibleCount)) : null;
  const total = typeof totalCount === "number" ? Math.max(0, Math.trunc(totalCount)) : null;
  const issueNoun = selected === 1 ? resultNounSingular : resultNounPlural;

  if (visible !== null && total !== null && total !== visible) {
    return `${selected} selected ${issueNoun} across ${visible} visible of ${total} results.`;
  }
  if (visible !== null) {
    return `${selected} selected ${issueNoun} across ${visible} visible results.`;
  }
  return `${selected} selected ${issueNoun}.`;
};

export const buildIssueImportCompactState = ({
  filters = [],
  selectedCount = 0,
  visibleCount,
  totalCount,
  sortField,
  sortDirection,
  sortFieldOptions,
  sortDirectionOptions,
  resultNounSingular,
  resultNounPlural,
}: IssueImportCompactStateInput): IssueImportCompactState => {
  const chips = buildIssueImportFilterSummaryChips(filters);
  const activeFilterCount = getIssueImportActiveFilterCount(filters);
  return {
    chips,
    activeFilterCount,
    activeFilterCountLabel: getIssueImportActiveFilterCountLabel(activeFilterCount),
    sortLabel: getIssueImportDefaultSortLabel(sortField, sortDirection, sortFieldOptions, sortDirectionOptions),
    selectedCountLabel: getIssueImportSelectedResultCountLabel(
      selectedCount,
      visibleCount,
      totalCount,
      resultNounSingular,
      resultNounPlural,
    ),
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
  const sourceLabel = source.provider === "jira"
    ? "Project"
    : source.provider === "notion"
      ? "Source"
      : source.provider === "asana"
        ? "Workspace"
        : source.provider === "linear"
          ? "Team"
          : "Repository";

  addMetadataRow(rows, "provider", "Provider", provider.label);
  addMetadataRow(rows, "sourceKind", "Kind", source.sourceKind);
  addMetadataRow(rows, "externalId", "External ID", source.externalId);
  addMetadataRow(rows, "repository", sourceLabel, normalizeText(source.teamKey) ?? normalizeText(source.projectKey) ?? source.repository);
  addMetadataRow(rows, "workspace", "Workspace", source.workspaceId);
  addMetadataRow(rows, "teamId", "Team ID", source.teamId);
  addMetadataRow(rows, "database", "Database", source.databaseId);
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
  const noun = provider === "notion" ? "items" : provider === "asana" ? "tasks" : "issues";
  if (!hasSearched) {
    return {
      title: `Search ${providerLabel} ${noun}`,
      description: "Choose filters and run a search to preview importable sprint context.",
    };
  }
  return {
    title: `No ${providerLabel} ${noun} found`,
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
