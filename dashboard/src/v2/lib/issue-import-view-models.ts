import { createDashboardFormatters } from "../i18n/formatters.js";
import {
  translateDashboardMessage,
  translateDashboardPlural,
  type DashboardLocale,
} from "../i18n/locales.js";
import { sprintsMessages } from "../i18n/messages/sprints.js";

export type IssueImportProvider =
  | "github"
  | "gitlab"
  | "jira"
  | "notion"
  | "asana"
  | "linear"
  | "miro"
  | "lucid"
  | "figma"
  | "mural";

export type IssueImportProviderIcon = IssueImportProvider;

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
  aliases: string[];
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
    aliases: ["github issues", "repository issues"],
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
    aliases: ["gitlab issues", "repository issues"],
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
    aliases: ["jira issues", "work items"],
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
    aliases: ["notion pages", "notion databases"],
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
    aliases: ["asana tasks", "work items"],
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
    aliases: ["linear issues", "work items"],
    accent: {
      badgeClassName: "border-[#5E6AD2]/25 bg-[#5E6AD2]/10 text-[#3F46A3] dark:text-[#B8BCF8]",
      selectedCardClassName: "border-[#5E6AD2]/35 bg-[#5E6AD2]/[0.08] shadow-[0_14px_32px_rgba(94,106,210,0.08)] dark:border-[#B8BCF8]/30 dark:bg-[#5E6AD2]/[0.12]",
      selectedIconClassName: "bg-[#5E6AD2] text-white",
      focusRingClassName: "focus-visible:ring-[#5E6AD2]/30",
    },
  },
  miro: {
    provider: "miro",
    label: "Miro",
    importLabel: "Miro canvas import",
    icon: "miro",
    aliases: ["miro boards", "miro canvas items"],
    accent: {
      badgeClassName: "border-[#FFD02F]/35 bg-[#FFD02F]/15 text-[#835B00] dark:text-[#FFE08A]",
      selectedCardClassName: "border-[#FFD02F]/40 bg-[#FFD02F]/[0.12] shadow-[0_14px_32px_rgba(255,208,47,0.1)] dark:border-[#FFE08A]/30 dark:bg-[#FFD02F]/[0.12]",
      selectedIconClassName: "bg-[#FFD02F] text-slate-950",
      focusRingClassName: "focus-visible:ring-[#FFD02F]/35",
    },
  },
  lucid: {
    provider: "lucid",
    label: "Lucid",
    importLabel: "Lucid document import",
    icon: "lucid",
    aliases: ["lucidchart", "lucidspark", "lucid documents"],
    accent: {
      badgeClassName: "border-[#FF7A1A]/30 bg-[#FF7A1A]/10 text-[#B64A00] dark:text-[#FDBA74]",
      selectedCardClassName: "border-[#FF7A1A]/35 bg-[#FF7A1A]/[0.08] shadow-[0_14px_32px_rgba(255,122,26,0.08)] dark:border-[#FDBA74]/30 dark:bg-[#FF7A1A]/[0.12]",
      selectedIconClassName: "bg-[#FF7A1A] text-white",
      focusRingClassName: "focus-visible:ring-[#FF7A1A]/30",
    },
  },
  figma: {
    provider: "figma",
    label: "Figma / FigJam",
    importLabel: "Figma / FigJam import",
    icon: "figma",
    aliases: ["figma files", "figjam boards"],
    accent: {
      badgeClassName: "border-[#A259FF]/25 bg-[#A259FF]/10 text-[#6D28D9] dark:text-[#D8B4FE]",
      selectedCardClassName: "border-[#A259FF]/35 bg-[#A259FF]/[0.08] shadow-[0_14px_32px_rgba(162,89,255,0.08)] dark:border-[#D8B4FE]/30 dark:bg-[#A259FF]/[0.12]",
      selectedIconClassName: "bg-[#A259FF] text-white",
      focusRingClassName: "focus-visible:ring-[#A259FF]/30",
    },
  },
  mural: {
    provider: "mural",
    label: "Mural",
    importLabel: "Mural canvas import",
    icon: "mural",
    aliases: ["mural workspaces", "mural canvases"],
    accent: {
      badgeClassName: "border-[#12B3A8]/25 bg-[#12B3A8]/10 text-[#0F766E] dark:text-[#67E8F9]",
      selectedCardClassName: "border-[#12B3A8]/35 bg-[#12B3A8]/[0.08] shadow-[0_14px_32px_rgba(18,179,168,0.08)] dark:border-[#67E8F9]/30 dark:bg-[#12B3A8]/[0.12]",
      selectedIconClassName: "bg-[#12B3A8] text-white",
      focusRingClassName: "focus-visible:ring-[#12B3A8]/30",
    },
  },
};

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeSummaryScalar = (value: string | number | boolean | null | undefined, locale: DashboardLocale = "en"): string | null => {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? createDashboardFormatters(locale).formatNumber(value) : null;
  }
  if (typeof value === "boolean") {
    return translateDashboardMessage(sprintsMessages, locale, value ? "yes" : "no");
  }
  return null;
};

const isSummaryArray = (value: IssueImportFilterSummaryValue): value is IssueImportFilterSummaryArray => (
  Array.isArray(value)
);

const normalizeSummaryValue = (value: IssueImportFilterSummaryValue, locale: DashboardLocale = "en"): string | null => {
  if (isSummaryArray(value)) {
    const normalized = value
      .map((item) => normalizeSummaryScalar(item, locale))
      .filter((item): item is string => item !== null);
    return normalized.length > 0 ? normalized.join(", ") : null;
  }
  return normalizeSummaryScalar(value, locale);
};

const formatDateTime = (value: string | null | undefined, locale: DashboardLocale = "en"): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return createDashboardFormatters(locale).formatDate(parsed, { dateStyle: "medium", timeStyle: "short" });
};

const formatState = (value: string | null | undefined, locale: DashboardLocale = "en"): string => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return translateDashboardMessage(sprintsMessages, locale, "unknown");
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
  locale: DashboardLocale = "en",
): IssueImportProviderMetadata => {
  const metadata = provider === "gitlab"
    || provider === "jira"
    || provider === "github"
    || provider === "notion"
    || provider === "asana"
    || provider === "linear"
    || provider === "miro"
    || provider === "lucid"
    || provider === "figma"
    || provider === "mural"
    ? PROVIDER_METADATA[provider]
    : PROVIDER_METADATA.github;
  return {
    ...metadata,
    importLabel: translateDashboardMessage(sprintsMessages, locale, ({
      github: "githubIssueImport",
      gitlab: "gitlabIssueImport",
      jira: "jiraIssueImport",
      notion: "notionScopeImport",
      asana: "asanaTaskImport",
      linear: "linearIssueImport",
      miro: "miroCanvasImport",
      lucid: "lucidDocumentImport",
      figma: "figmaImport",
      mural: "muralCanvasImport",
    } as const)[metadata.provider]),
    accent: {
      ...metadata.accent,
      ...accentOverride,
    },
  };
};

export const getIssueImportActiveFilterCount = (
  filters: ReadonlyArray<IssueImportFilterSummaryInput>,
  locale: DashboardLocale = "en",
): number => filters.reduce((count, filter) => {
  const value = normalizeSummaryValue(filter.value, locale);
  const defaultValue = normalizeSummaryValue(filter.defaultValue, locale);
  const active = value !== null && value !== defaultValue;
  return active ? count + 1 : count;
}, 0);

export const buildIssueImportFilterSummaryChips = (
  filters: ReadonlyArray<IssueImportFilterSummaryInput>,
  locale: DashboardLocale = "en",
): IssueImportFilterSummaryChip[] => filters
  .map((filter, index) => {
    const value = normalizeSummaryValue(filter.value, locale);
    const defaultValue = normalizeSummaryValue(filter.defaultValue, locale);
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
        label: normalizeText(filter.label) ?? translateDashboardMessage(sprintsMessages, locale, "filter"),
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

export const getIssueImportActiveFilterCountLabel = (activeFilterCount: number, locale: DashboardLocale = "en"): string => {
  if (activeFilterCount <= 0) {
    return translateDashboardMessage(sprintsMessages, locale, "activeFiltersNone");
  }
  return translateDashboardPlural(sprintsMessages, locale, "activeFilters", activeFilterCount, {
    count: createDashboardFormatters(locale).formatNumber(activeFilterCount),
  });
};

export const getIssueImportDefaultSortLabel = (
  sortField?: string | null,
  sortDirection?: string | null,
  sortFieldOptions: ReadonlyArray<{ value: string; label: string }> = [],
  sortDirectionOptions: ReadonlyArray<{ value: string; label: string }> = [],
  locale: DashboardLocale = "en",
): string => {
  const normalizedField = normalizeText(sortField ?? undefined);
  const normalizedDirection = normalizeText(sortDirection ?? undefined);
  const fieldLabel = sortFieldOptions.find((option) => option.value === normalizedField)?.label
    ?? normalizedField
    ?? translateDashboardMessage(sprintsMessages, locale, "default");
  const directionLabel = sortDirectionOptions.find((option) => option.value === normalizedDirection)?.label
    ?? (normalizedDirection === "desc"
      ? translateDashboardMessage(sprintsMessages, locale, "newestFirst")
      : normalizedDirection === "asc"
        ? translateDashboardMessage(sprintsMessages, locale, "oldestFirst")
        : null);

  return directionLabel ? `${fieldLabel}, ${directionLabel}` : fieldLabel;
};

export const getIssueImportSelectedResultCountLabel = (
  selectedCount: number,
  visibleCount?: number,
  totalCount?: number,
  resultNounSingular = "issue",
  resultNounPlural = "issues",
  locale: DashboardLocale = "en",
): string => {
  const selected = Math.max(0, Math.trunc(selectedCount));
  const visible = typeof visibleCount === "number" ? Math.max(0, Math.trunc(visibleCount)) : null;
  const total = typeof totalCount === "number" ? Math.max(0, Math.trunc(totalCount)) : null;
  const issueNoun = selected === 1 ? resultNounSingular : resultNounPlural;

  const formatNumber = createDashboardFormatters(locale).formatNumber;
  if (visible !== null && total !== null && total !== visible) {
    return translateDashboardMessage(sprintsMessages, locale, "selectedResultsWindowed", { selected: formatNumber(selected), noun: issueNoun, visible: formatNumber(visible), total: formatNumber(total) });
  }
  if (visible !== null) {
    return translateDashboardMessage(sprintsMessages, locale, "selectedResultsVisible", { selected: formatNumber(selected), noun: issueNoun, visible: formatNumber(visible) });
  }
  return translateDashboardMessage(sprintsMessages, locale, "selectedResults", { selected: formatNumber(selected), noun: issueNoun });
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
}: IssueImportCompactStateInput, locale: DashboardLocale = "en"): IssueImportCompactState => {
  const chips = buildIssueImportFilterSummaryChips(filters, locale);
  const activeFilterCount = getIssueImportActiveFilterCount(filters, locale);
  return {
    chips,
    activeFilterCount,
    activeFilterCountLabel: getIssueImportActiveFilterCountLabel(activeFilterCount, locale),
    sortLabel: getIssueImportDefaultSortLabel(sortField, sortDirection, sortFieldOptions, sortDirectionOptions, locale),
    selectedCountLabel: getIssueImportSelectedResultCountLabel(
      selectedCount,
      visibleCount,
      totalCount,
      resultNounSingular,
      resultNounPlural,
      locale,
    ),
  };
};

export const getSelectedIssueCountLabel = (
  selectedCount: number,
  linkedCount?: number,
  specialTaskCount?: number,
  locale: DashboardLocale = "en",
): string => {
  if (selectedCount <= 0) {
    return translateDashboardMessage(sprintsMessages, locale, "noIssuesSelected");
  }

  const issueNoun = translateDashboardMessage(sprintsMessages, locale, selectedCount === 1 ? "issueSingular" : "issuePlural");
  const formatNumber = createDashboardFormatters(locale).formatNumber;
  if (linkedCount === undefined && specialTaskCount === undefined) {
    return translateDashboardMessage(sprintsMessages, locale, "selectedIssuesImport", { count: formatNumber(selectedCount), noun: issueNoun });
  }

  const linked = Math.max(0, linkedCount ?? selectedCount - (specialTaskCount ?? 0));
  const special = Math.max(0, specialTaskCount ?? selectedCount - linked);
  const specialNoun = translateDashboardMessage(sprintsMessages, locale, special === 1 ? "taskSingular" : "taskPlural");
  return translateDashboardMessage(sprintsMessages, locale, "selectedIssuesBreakdown", {
    count: formatNumber(selectedCount), noun: issueNoun, linked: formatNumber(linked), special: formatNumber(special), taskNoun: specialNoun,
  });
};

export const buildIssueImportMetadataRows = (source: IssueImportMetadataSource, locale: DashboardLocale = "en"): IssueImportMetadataRow[] => {
  const rows: IssueImportMetadataRow[] = [];
  const provider = getIssueImportProviderMetadata(source.provider, undefined, locale);
  const issueRef = normalizeText(source.issueKey) ?? (source.issueNumber ? `#${source.issueNumber}` : null);
  const sourceLabel = source.provider === "jira"
    ? translateDashboardMessage(sprintsMessages, locale, "project")
    : source.provider === "notion"
      ? translateDashboardMessage(sprintsMessages, locale, "source")
      : source.provider === "asana"
        ? translateDashboardMessage(sprintsMessages, locale, "workspace")
      : source.provider === "linear"
          ? translateDashboardMessage(sprintsMessages, locale, "team")
          : source.provider === "miro"
            ? translateDashboardMessage(sprintsMessages, locale, "board")
            : source.provider === "lucid"
              ? translateDashboardMessage(sprintsMessages, locale, "documents")
              : source.provider === "figma"
                ? translateDashboardMessage(sprintsMessages, locale, "files")
                : source.provider === "mural"
                  ? translateDashboardMessage(sprintsMessages, locale, "workspace")
          : translateDashboardMessage(sprintsMessages, locale, "repository");

  addMetadataRow(rows, "provider", translateDashboardMessage(sprintsMessages, locale, "provider"), provider.label);
  addMetadataRow(rows, "sourceKind", translateDashboardMessage(sprintsMessages, locale, "kind"), formatSourceKind(source.provider, source.sourceKind, locale));
  addMetadataRow(rows, "externalId", translateDashboardMessage(sprintsMessages, locale, "externalId"), source.externalId);
  addMetadataRow(rows, "repository", sourceLabel, normalizeText(source.teamKey) ?? normalizeText(source.projectKey) ?? source.repository);
  addMetadataRow(rows, "workspace", translateDashboardMessage(sprintsMessages, locale, "workspace"), source.workspaceId);
  addMetadataRow(rows, "teamId", translateDashboardMessage(sprintsMessages, locale, "teamId"), source.teamId);
  addMetadataRow(rows, "database", translateDashboardMessage(sprintsMessages, locale, "database"), source.databaseId);
  addMetadataRow(rows, "issue", translateDashboardMessage(sprintsMessages, locale, "issue"), issueRef);
  addMetadataRow(rows, "state", translateDashboardMessage(sprintsMessages, locale, "state"), formatState(source.state, locale));
  addMetadataRow(rows, "type", translateDashboardMessage(sprintsMessages, locale, "type"), source.issueType);
  addMetadataRow(rows, "priority", translateDashboardMessage(sprintsMessages, locale, "priority"), source.priority);
  addMetadataRow(rows, "author", translateDashboardMessage(sprintsMessages, locale, "author"), source.issueAuthor);
  addMetadataRow(rows, "reporter", translateDashboardMessage(sprintsMessages, locale, "reporter"), source.issueReporter);
  addMetadataRow(rows, "milestone", translateDashboardMessage(sprintsMessages, locale, "milestone"), source.issueMilestone);
  if (typeof source.issueCommentCount === "number") {
    rows.push({
      id: "comments",
      label: translateDashboardMessage(sprintsMessages, locale, "comments"),
      value: createDashboardFormatters(locale).formatNumber(Math.max(0, source.issueCommentCount)),
    });
  }
  addMetadataRow(rows, "created", translateDashboardMessage(sprintsMessages, locale, "created"), formatDateTime(source.createdAt, locale));
  addMetadataRow(rows, "updated", translateDashboardMessage(sprintsMessages, locale, "updated"), formatDateTime(source.updatedAt, locale));

  return rows;
};

export const truncateIssueImportList = (
  values: ReadonlyArray<string | null | undefined>,
  maxVisible = 6,
  locale: DashboardLocale = "en",
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
    overflowLabel: overflowCount > 0
      ? translateDashboardMessage(sprintsMessages, locale, "more", { count: createDashboardFormatters(locale).formatNumber(overflowCount) })
      : null,
  };
};

export const truncateIssueImportLabels = (
  labels: ReadonlyArray<string | null | undefined>,
  maxVisible = 6,
  locale: DashboardLocale = "en",
): IssueImportTruncatedList => truncateIssueImportList(labels, maxVisible, locale);

export const truncateIssueImportAssignees = (
  assignees: ReadonlyArray<string | null | undefined>,
  maxVisible = 4,
  locale: DashboardLocale = "en",
): IssueImportTruncatedList => truncateIssueImportList(assignees, maxVisible, locale);

export const getIssueImportEmptyStateCopy = (
  provider: IssueImportProvider,
  hasSearched: boolean,
  locale: DashboardLocale = "en",
): IssueImportEmptyStateCopy => {
  const providerLabel = getIssueImportProviderMetadata(provider, undefined, locale).label;
  const nounKey = provider === "notion"
    ? "nounItems"
    : provider === "asana"
      ? "nounTasks"
      : provider === "miro"
        ? "nounBoardsCanvas"
        : provider === "lucid"
          ? "nounDocuments"
          : provider === "figma"
            ? "nounFiles"
            : provider === "mural"
              ? "nounMurals"
      : "nounIssues";
  const noun = translateDashboardMessage(sprintsMessages, locale, nounKey);
  if (!hasSearched) {
    return {
      title: translateDashboardMessage(sprintsMessages, locale, "searchProviderNoun", { provider: providerLabel, noun }),
      description: provider === "figma"
        ? translateDashboardMessage(sprintsMessages, locale, "emptyFigmaDescription")
        : provider === "mural"
          ? translateDashboardMessage(sprintsMessages, locale, "emptyMuralDescription")
          : translateDashboardMessage(sprintsMessages, locale, "emptySearchDescription"),
    };
  }
  return {
    title: translateDashboardMessage(sprintsMessages, locale, "noProviderNounFound", { provider: providerLabel, noun }),
    description: provider === "miro" || provider === "lucid" || provider === "figma" || provider === "mural"
      ? translateDashboardMessage(sprintsMessages, locale, "noCanvasResultsDescription")
      : translateDashboardMessage(sprintsMessages, locale, "noIssueResultsDescription"),
  };
};

export const getIssueImportErrorCopy = (
  error: unknown,
  fallbackMessage?: string,
  locale: DashboardLocale = "en",
): IssueImportErrorCopy => {
  const localizedFallback = fallbackMessage ?? translateDashboardMessage(sprintsMessages, locale, "issueSearchFallback");
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : localizedFallback;
  return {
    title: translateDashboardMessage(sprintsMessages, locale, "issueImportFailed"),
    message: normalizeText(message) ?? localizedFallback,
  };
};

function formatSourceKind(
  provider: IssueImportProvider,
  sourceKind: string | null | undefined,
  locale: DashboardLocale,
): string | null {
  const normalized = normalizeText(sourceKind);
  if (!normalized) {
    return null;
  }
  if (provider === "miro" && normalized === "board") {
    return translateDashboardMessage(sprintsMessages, locale, "board");
  }
  if (provider === "miro" && normalized === "canvas") {
    return translateDashboardMessage(sprintsMessages, locale, "canvasItem");
  }
  if (provider === "lucid" && normalized === "document") {
    return translateDashboardMessage(sprintsMessages, locale, "document");
  }
  if (provider === "figma" && normalized === "file") {
    return translateDashboardMessage(sprintsMessages, locale, "file");
  }
  if (provider === "mural" && normalized === "canvas") {
    return translateDashboardMessage(sprintsMessages, locale, "canvas");
  }
  return normalized.replace(/[_-]+/g, " ");
}
