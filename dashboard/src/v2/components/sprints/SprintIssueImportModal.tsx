import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  CheckSquare,
  Github,
  Gitlab,
  Search,
  Shield,
  GitMerge,
  Loader2,
  MessageSquare,
} from "lucide-preact";
import type {
  Source,
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
} from "../../types.js";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
  type RemoteIssueSummary,
} from "../../lib/project-api.js";
import { MultiSelect } from "../ui/MultiSelect.js";
import {
  buildIssueImportCompactState,
  buildIssueImportMetadataRows,
  getIssueImportEmptyStateCopy,
  getIssueImportErrorCopy,
  getIssueImportProviderMetadata,
  getSelectedIssueCountLabel,
  truncateIssueImportAssignees,
  truncateIssueImportLabels,
  type IssueImportProvider,
} from "../../lib/issue-import-view-models.js";
import { IssueImportEmptyState } from "./importer/IssueImportEmptyState.js";
import {
  IssueImportDateInput,
  IssueImportField,
  IssueImportFilterSection,
  IssueImportMultiSelectField,
  IssueImportSelect,
  IssueImportTextInput,
} from "./importer/IssueImportFields.js";
import {
  IssueImportErrorPanel,
  IssueImportLoadingSkeletonList,
  IssueImportShell,
} from "./importer/IssueImportShell.js";
import { IssueImportIssueCard } from "./importer/IssueImportIssueCard.js";
import { IssueImportSummaryRail } from "./importer/IssueImportSummaryRail.js";

interface SprintIssueImportModalProps {
  project: Source;
  initialProvider?: RepositoryIssueProvider;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void | Promise<void>;
  onImportSpecialTasks?: (tasks: SprintImportedTaskInput[]) => void | Promise<void>;
}

type RepositoryIssueProvider = Extract<IssueImportProvider, "github" | "gitlab">;

interface IssueFilters {
  provider: RepositoryIssueProvider;
  hostDomain: string;
  repository: string;
  search: string;
  state: "open" | "closed" | "all";
  labels: string[];
  assignee: string;
  author: string;
  milestone: string;
  updatedAfter: string;
  updatedBefore: string;
  sortField: "updated" | "created" | "comments";
  sortDirection: "asc" | "desc";
  limit: number;
}

interface QuickFilterPreset {
  id: string;
  label: string;
  description: string;
  apply: (filters: IssueFilters) => IssueFilters;
}

const SEARCH_LIMITS = [20, 40, 60, 100] as const;
const SORT_FIELD_OPTIONS = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "comments", label: "Comments" },
] as const;
const SORT_DIRECTION_OPTIONS = [
  { value: "desc", label: "Newest first" },
  { value: "asc", label: "Oldest first" },
] as const;

const STATE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

const DEFAULT_HOST_BY_PROVIDER: Record<RepositoryIssueProvider, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

const SPECIAL_TASK_KINDS: Array<{
  kind: SprintImportedTaskInput["kind"];
  label: string;
  description: string;
  tone: string;
  icon: typeof Shield;
}> = [
  {
    kind: "security",
    label: "Security",
    description: "Turn the selected issues into security remediation tasks.",
    tone: "border-status-red/20 bg-status-red/10 text-status-red",
    icon: Shield,
  },
  {
    kind: "quality",
    label: "Quality",
    description: "Turn the selected issues into quality follow-up tasks.",
    tone: "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300",
    icon: CheckSquare,
  },
  {
    kind: "merge_conflict",
    label: "Merge conflict",
    description: "Turn the selected issues into merge-conflict tasks.",
    tone: "border-ember-500/20 bg-ember-500/10 text-ember-600 dark:text-ember-400",
    icon: GitMerge,
  },
  {
    kind: "failed_ci",
    label: "Failed CI",
    description: "Turn the selected issues into CI repair tasks.",
    tone: "border-slate-900/10 bg-slate-900/[0.04] text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200",
    icon: Loader2,
  },
];

const inferRepository = (project: Source): string => {
  const source = project.repoUrl || project.sourceRef || "";
  const cleaned = source.trim().replace(/\.git$/i, "").replace(/\/+$/g, "");
  if (!cleaned) return "";
  const httpsMatch = cleaned.match(/^https?:\/\/[^/]+\/(.+)$/i);
  if (httpsMatch) return httpsMatch[1] || "";
  const sshMatch = cleaned.match(/^[^@]+@[^:/]+[:/](.+)$/i);
  if (sshMatch) return sshMatch[1] || "";
  return "";
};

const inferSourceHostDomain = (project: Source): string | null => {
  const source = (project.repoUrl || project.sourceRef || "").trim();
  if (!source) {
    return null;
  }
  try {
    if (/^https?:\/\//i.test(source)) {
      return new URL(source).hostname;
    }
    const sshMatch = source.match(/^[^@]+@([^:/]+)[:/]/i);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }
  } catch {
    return null;
  }
  return null;
};

const hostLooksLikeProvider = (hostDomain: string | null | undefined, provider: RepositoryIssueProvider): boolean => {
  const normalized = hostDomain?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes(provider);
};

const inferHostDomain = (project: Source, provider: RepositoryIssueProvider): string => {
  const configuredHost = project.gitHostDomain?.trim();
  if (configuredHost && (project.gitProvider === provider || hostLooksLikeProvider(configuredHost, provider))) {
    return configuredHost;
  }
  const sourceHost = inferSourceHostDomain(project);
  if (sourceHost && hostLooksLikeProvider(sourceHost, provider)) {
    return sourceHost;
  }
  return DEFAULT_HOST_BY_PROVIDER[provider];
};

const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const buildSpecialTaskTitle = (issue: RemoteIssueSummary, kind: SprintImportedTaskInput["kind"]): string => {
  switch (kind) {
    case "security":
      return `Security follow-up: ${issue.title}`;
    case "quality":
      return `Quality follow-up: ${issue.title}`;
    case "merge_conflict":
      return `Resolve merge conflict: ${issue.title}`;
    case "failed_ci":
      return `Repair failed CI: ${issue.title}`;
  }
};

const buildSpecialTaskInput = (
  issue: RemoteIssueSummary,
  kind: SprintImportedTaskInput["kind"],
): SprintImportedTaskInput => ({
  kind,
  title: buildSpecialTaskTitle(issue, kind),
  sourceUrl: issue.url,
  sourcePath: issue.url,
  provider: issue.provider,
  repository: issue.repository,
  labels: issue.labels,
  errorMessage: issue.bodyPreview || undefined,
});

export const SprintIssueImportModal: FunctionComponent<SprintIssueImportModalProps> = ({
  project,
  initialProvider: requestedInitialProvider,
  onClose,
  onImport,
  onImportSpecialTasks,
}) => {
  const initialProvider: RepositoryIssueProvider = requestedInitialProvider
    ?? (project.gitProvider === "gitlab" ? "gitlab" : "github");
  const [filters, setFilters] = useState<IssueFilters>({
    provider: initialProvider,
    hostDomain: inferHostDomain(project, initialProvider),
    repository: inferRepository(project),
    search: "",
    state: "open",
    labels: [],
    assignee: "",
    author: "",
    milestone: "",
    updatedAfter: "",
    updatedBefore: "",
    sortField: "updated",
    sortDirection: "desc",
    limit: 40,
  });
  const [issues, setIssues] = useState<RemoteIssueSummary[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastPreset, setLastPreset] = useState<string | null>(null);
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const initialFiltersRef = useRef<IssueFilters>({
    provider: initialProvider,
    hostDomain: inferHostDomain(project, initialProvider),
    repository: inferRepository(project),
    search: "",
    state: "open",
    labels: [],
    assignee: "",
    author: "",
    milestone: "",
    updatedAfter: "",
    updatedBefore: "",
    sortField: "updated",
    sortDirection: "desc",
    limit: 40,
  });
  const providerPreviousDefaultRef = useRef(inferHostDomain(project, initialProvider));

  const selectedIssues = useMemo(
    () => issues.filter((issue) => selectedKeys.has(issueKey(issue))),
    [issues, selectedKeys],
  );

  const allVisibleSelected = issues.length > 0 && selectedIssues.length === issues.length;
  const anySelected = selectedIssues.length > 0;
  const allSelectedConversationEnabled = anySelected
    && selectedIssues.every((issue) => !conversationDisabledKeys.has(issueKey(issue)));

  const executeSearch = useCallback(async (query: IssueFilters): Promise<void> => {
    if (!query.repository.trim()) {
      setError("Enter an owner/repository value before searching issues.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const results = await searchProjectIssues(project.id, {
        provider: query.provider,
        repository: query.repository.trim(),
        hostDomain: query.hostDomain.trim(),
        search: query.search.trim(),
        state: query.state,
        labels: query.labels,
        assignee: query.assignee.trim(),
        author: query.author.trim(),
        milestone: query.milestone.trim(),
        updatedAfter: query.updatedAfter.trim(),
        updatedBefore: query.updatedBefore.trim(),
        sortField: query.sortField,
        sortDirection: query.sortDirection,
        limit: query.limit,
      }, controller.signal);
      setIssues(results);
      setSelectedKeys((current) => new Set([...current].filter((key) => results.some((issue) => issueKey(issue) === key))));
      setConversationDisabledKeys((current) => new Set([...current].filter((key) => results.some((issue) => issueKey(issue) === key))));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setIssues([]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void executeSearch(initialFiltersRef.current);
    return () => abortRef.current?.abort();
  }, [executeSearch]);

  useEffect(() => {
    const defaultHost = inferHostDomain(project, filters.provider);
    const hostMatchesPreviousDefault = filters.hostDomain === providerPreviousDefaultRef.current;
    if (!filters.hostDomain.trim() || (hostMatchesPreviousDefault && defaultHost !== providerPreviousDefaultRef.current)) {
      setFilters((current) => ({ ...current, hostDomain: defaultHost }));
    }
    providerPreviousDefaultRef.current = defaultHost;
  }, [filters.provider, filters.hostDomain, project]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const updateFilters = useCallback((updater: (current: IssueFilters) => IssueFilters) => {
    setFilters((current) => updater(current));
  }, []);

  const toggleIssue = useCallback((issue: RemoteIssueSummary): void => {
    const key = issueKey(issue);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleConversation = useCallback((issue: RemoteIssueSummary): void => {
    const key = issueKey(issue);
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const setConversationForSelection = useCallback((enabled: boolean): void => {
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      for (const issue of selectedIssues) {
        const key = issueKey(issue);
        if (enabled) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }, [selectedIssues]);

  const selectAllVisible = useCallback((): void => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        for (const issue of issues) {
          next.delete(issueKey(issue));
        }
        return next;
      }
      const next = new Set(current);
      for (const issue of issues) {
        next.add(issueKey(issue));
      }
      return next;
    });
  }, [allVisibleSelected, issues]);

  const clearSelection = useCallback((): void => {
    setSelectedKeys(new Set());
    setConversationDisabledKeys(new Set());
  }, []);

  const applyPreset = useCallback(async (preset: QuickFilterPreset): Promise<void> => {
    const nextFilters = preset.apply(filters);
    setFilters(nextFilters);
    setLastPreset(preset.id);
    await executeSearch(nextFilters);
  }, [executeSearch, filters]);

  const handleImportLinkedIssues = useCallback(async (): Promise<void> => {
    if (selectedIssues.length === 0) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const contexts = await fetchProjectIssuePromptContexts(project.id, selectedIssues.map((issue) => ({
        ...issue,
        includeConversation: !conversationDisabledKeys.has(issueKey(issue)),
      })));
      await onImport(contexts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [conversationDisabledKeys, onImport, project.id, selectedIssues]);

  const handleImportSpecialTasks = useCallback(async (kind: SprintImportedTaskInput["kind"]): Promise<void> => {
    if (selectedIssues.length === 0 || !onImportSpecialTasks) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      await onImportSpecialTasks(selectedIssues.map((issue) => buildSpecialTaskInput(issue, kind)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [onImportSpecialTasks, selectedIssues]);

  const quickFilterPresets = useMemo<QuickFilterPreset[]>(() => [
    {
      id: "open-backlog",
      label: "Open backlog",
      description: "Open issues sorted by the latest update.",
      apply: (current) => ({
        ...current,
        state: "open",
        sortField: "updated",
        sortDirection: "desc",
      }),
    },
    {
      id: "recently-updated",
      label: "Recently updated",
      description: "Open issues updated in the last 30 days.",
      apply: (current) => ({
        ...current,
        state: "open",
        updatedAfter: daysAgo(30),
        sortField: "updated",
        sortDirection: "desc",
      }),
    },
    {
      id: "assigned-text",
      label: "Assigned to me / text user",
      description: "Fill the assignee field with a handle or user text.",
      apply: (current) => ({
        ...current,
        state: "open",
        assignee: current.assignee || "me",
      }),
    },
    {
      id: "security",
      label: "Security-labeled work",
      description: "Search for security-tagged or security-related work.",
      apply: (current) => ({
        ...current,
        state: "open",
        labels: ["security"],
        search: "security",
      }),
    },
    {
      id: "quality",
      label: "Quality / tech debt",
      description: "Search for quality, bug, and technical debt follow-ups.",
      apply: (current) => ({
        ...current,
        state: "open",
        labels: ["quality", "tech debt"],
        search: "quality bug tech debt regression",
      }),
    },
    {
      id: "failed-ci",
      label: "Failed CI work",
      description: "Search for CI, build, and test failure follow-ups.",
      apply: (current) => ({
        ...current,
        state: "open",
        search: "failed ci build test pipeline",
      }),
    },
    {
      id: "merge-conflict",
      label: "Merge conflict work",
      description: "Search for merge conflict and branch integration work.",
      apply: (current) => ({
        ...current,
        state: "open",
        search: "merge conflict conflict rebase",
      }),
    },
  ], []);

  const visibleSelectedCount = selectedIssues.length;
  const providerMetadata = getIssueImportProviderMetadata(filters.provider);
  const emptyCopy = getIssueImportEmptyStateCopy(filters.provider, hasSearched);
  const searchDisabledLabel = loading ? "Search issues is disabled while issue search is loading." : "Search issues";
  const importLinkedLabel = !anySelected
    ? "Import as linked issues is disabled because no issues are selected."
    : importing
      ? "Import as linked issues is disabled while import is running."
      : `Import as linked issues: ${visibleSelectedCount} selected issue${visibleSelectedCount === 1 ? "" : "s"}.`;
  const selectVisibleLabel = allVisibleSelected ? "Deselect all visible results" : "Select all visible results";
  const clearSelectionDisabled = !anySelected && selectedKeys.size === 0;
  const compactState = buildIssueImportCompactState({
    filters: [
      { id: "provider", label: "Provider", value: providerMetadata.label, defaultValue: getIssueImportProviderMetadata(initialFiltersRef.current.provider).label, alwaysShow: true, priority: 1 },
      { id: "host", label: "Host", value: filters.hostDomain, defaultValue: initialFiltersRef.current.hostDomain, alwaysShow: true, priority: 2 },
      { id: "repository", label: "Repository", value: filters.repository, defaultValue: initialFiltersRef.current.repository, alwaysShow: true, priority: 3 },
      { id: "search", label: "Search", value: filters.search, priority: 4 },
      { id: "state", label: "State", value: filters.state, defaultValue: "open", alwaysShow: true, priority: 5 },
      { id: "labels", label: "Labels", value: filters.labels, priority: 6 },
      { id: "assignee", label: "Assignee", value: filters.assignee, priority: 7 },
      { id: "author", label: "Author", value: filters.author, priority: 8 },
      { id: "milestone", label: "Milestone", value: filters.milestone, priority: 9 },
      { id: "updatedAfter", label: "Updated after", value: filters.updatedAfter, priority: 10 },
      { id: "updatedBefore", label: "Updated before", value: filters.updatedBefore, priority: 11 },
      { id: "limit", label: "Limit", value: filters.limit, defaultValue: 40, defaultLabel: "40 results", alwaysShow: true, priority: 12 },
    ],
    selectedCount: visibleSelectedCount,
    visibleCount: issues.length,
    sortField: filters.sortField,
    sortDirection: filters.sortDirection,
    sortFieldOptions: SORT_FIELD_OPTIONS,
    sortDirectionOptions: SORT_DIRECTION_OPTIONS,
  });

  const filtersContent = (
    <div className="grid gap-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.45fr)]">
        <IssueImportFilterSection
          title="Provider"
          description="Choose the issue host for this search."
          compact
        >
          <div className="grid min-w-0 grid-cols-2 gap-2" role="group" aria-label="Issue provider">
            {(["github", "gitlab"] as const).map((provider) => {
              const Icon = provider === "github" ? Github : Gitlab;
              const active = filters.provider === provider;
              const metadata = getIssueImportProviderMetadata(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => updateFilters((current) => ({
                    ...current,
                    provider,
                    hostDomain: inferHostDomain(project, provider),
                  }))}
                  className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-[1rem] border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all focus-visible:outline-none focus-visible:ring-2 ${metadata.accent.focusRingClassName} ${
                    active
                      ? metadata.accent.badgeClassName
                      : "border-black/[0.07] bg-white/80 text-slate-500 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-white"
                  }`}
                  aria-pressed={active}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                  <span className="truncate">{metadata.label}</span>
                </button>
              );
            })}
          </div>
        </IssueImportFilterSection>

        <IssueImportFilterSection
          title="Repository target"
          description="Confirm the host and owner/repository before searching."
          compact
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(10rem,0.85fr)_minmax(13rem,1.15fr)]">
            <IssueImportField label="Host">
              <IssueImportTextInput
                provider={providerMetadata}
                value={filters.hostDomain}
                onInput={(event) => updateFilters((current) => ({ ...current, hostDomain: (event.target as HTMLInputElement).value }))}
                placeholder={DEFAULT_HOST_BY_PROVIDER[filters.provider]}
                autoComplete="off"
              />
            </IssueImportField>
            <IssueImportField label="Repository" required>
              <IssueImportTextInput
                provider={providerMetadata}
                value={filters.repository}
                onInput={(event) => updateFilters((current) => ({ ...current, repository: (event.target as HTMLInputElement).value }))}
                placeholder="owner/repository"
                autoComplete="off"
              />
            </IssueImportField>
          </div>
        </IssueImportFilterSection>
      </div>

      <IssueImportFilterSection
        title="Search and ordering"
        description="Default search uses open issues, recent updates, and a 40 issue limit."
        compact
      >
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(18rem,1.4fr)_repeat(4,minmax(8rem,0.65fr))]">
          <IssueImportField label="Search">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <IssueImportTextInput
                provider={providerMetadata}
                value={filters.search}
                onInput={(event) => updateFilters((current) => ({ ...current, search: (event.target as HTMLInputElement).value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void executeSearch(filters);
                  }
                }}
                placeholder="Title, body, or issue text"
                className="pl-10"
              />
            </div>
          </IssueImportField>
          <IssueImportField label="State">
            <IssueImportSelect
              provider={providerMetadata}
              aria-label="State"
              value={filters.state}
              onChange={(value) => updateFilters((current) => ({ ...current, state: value as IssueFilters["state"] }))}
              options={STATE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </IssueImportField>
          <IssueImportField label="Sort">
            <IssueImportSelect
              provider={providerMetadata}
              aria-label="Sort"
              value={filters.sortField}
              onChange={(value) => updateFilters((current) => ({ ...current, sortField: value as IssueFilters["sortField"] }))}
              options={SORT_FIELD_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </IssueImportField>
          <IssueImportField label="Direction">
            <IssueImportSelect
              provider={providerMetadata}
              aria-label="Direction"
              value={filters.sortDirection}
              onChange={(value) => updateFilters((current) => ({ ...current, sortDirection: value as IssueFilters["sortDirection"] }))}
              options={SORT_DIRECTION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </IssueImportField>
          <IssueImportField label="Limit">
            <IssueImportSelect
              provider={providerMetadata}
              aria-label="Limit"
              value={filters.limit}
              onChange={(value) => updateFilters((current) => ({ ...current, limit: Number(value) }))}
              options={SEARCH_LIMITS.map((value) => ({ value: String(value), label: String(value) }))}
            />
          </IssueImportField>
        </div>

        <button
          type="button"
          onClick={() => { void executeSearch(filters); }}
          disabled={loading}
          aria-label={searchDisabledLabel}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[1rem] bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 sm:w-auto sm:justify-self-end"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          Search issues
        </button>
      </IssueImportFilterSection>
    </div>
  );

  const advancedFiltersContent = (
    <>
      <IssueImportFilterSection
        title="People, labels, and milestone"
        description="Narrow results by issue metadata only when the primary search is too broad."
        compact
      >
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <IssueImportMultiSelectField label="Labels">
            <MultiSelect
              value={filters.labels}
              onChange={(labels) => updateFilters((current) => ({ ...current, labels }))}
              placeholder="bug, security"
            />
          </IssueImportMultiSelectField>
          <IssueImportField label="Assignee">
            <IssueImportTextInput
              provider={providerMetadata}
              value={filters.assignee}
              onInput={(event) => updateFilters((current) => ({ ...current, assignee: (event.target as HTMLInputElement).value }))}
              placeholder="me or alice"
              autoComplete="off"
            />
          </IssueImportField>
          <IssueImportField label="Author">
            <IssueImportTextInput
              provider={providerMetadata}
              value={filters.author}
              onInput={(event) => updateFilters((current) => ({ ...current, author: (event.target as HTMLInputElement).value }))}
              placeholder="octocat"
              autoComplete="off"
            />
          </IssueImportField>
          <IssueImportField label="Milestone">
            <IssueImportTextInput
              provider={providerMetadata}
              value={filters.milestone}
              onInput={(event) => updateFilters((current) => ({ ...current, milestone: (event.target as HTMLInputElement).value }))}
              placeholder="v1.2"
              autoComplete="off"
            />
          </IssueImportField>
        </div>
      </IssueImportFilterSection>

      <IssueImportFilterSection
        title="Updated date window"
        description="Filter issues by the date range returned by the provider."
        compact
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <IssueImportField label="Updated after">
            <div className="relative min-w-0">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <IssueImportDateInput
                provider={providerMetadata}
                value={filters.updatedAfter}
                onChange={(event) => updateFilters((current) => ({ ...current, updatedAfter: (event.target as HTMLInputElement).value }))}
                className="pl-10"
              />
            </div>
          </IssueImportField>
          <IssueImportField label="Updated before">
            <div className="relative min-w-0">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <IssueImportDateInput
                provider={providerMetadata}
                value={filters.updatedBefore}
                onChange={(event) => updateFilters((current) => ({ ...current, updatedBefore: (event.target as HTMLInputElement).value }))}
                className="pl-10"
              />
            </div>
          </IssueImportField>
        </div>
      </IssueImportFilterSection>

      <IssueImportFilterSection
        title="Quick presets"
        description="Apply common triage searches and run them immediately."
        compact
      >
        <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-4">
          {quickFilterPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => { void applyPreset(preset); }}
              className={`min-w-0 rounded-[1rem] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 ${providerMetadata.accent.focusRingClassName} ${
                lastPreset === preset.id
                  ? providerMetadata.accent.selectedCardClassName
                  : "border-black/[0.06] bg-white/76 text-slate-600 hover:border-black/[0.12] hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.05]"
              }`}
            >
              <div className="truncate text-xs font-bold">{preset.label}</div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </IssueImportFilterSection>
    </>
  );

  const resultsContent = (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {issues.length} visible result{issues.length === 1 ? "" : "s"}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${visibleSelectedCount > 0 ? providerMetadata.accent.badgeClassName : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"}`}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {visibleSelectedCount} selected
          </span>
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/[0.06] bg-white/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Sort: {compactState.sortLabel}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAllVisible}
            disabled={issues.length === 0}
            aria-label={selectVisibleLabel}
            className={`rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white`}
          >
            {allVisibleSelected ? "Deselect visible" : "Select visible"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={clearSelectionDisabled}
            aria-label={clearSelectionDisabled ? "Clear selection is disabled because no issues are selected." : "Clear selected issues"}
            className={`rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white`}
          >
            Clear selection
          </button>
        </div>
      </div>

      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        {compactState.chips.map((chip) => (
          <span
            key={chip.id}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
              chip.active
                ? providerMetadata.accent.badgeClassName
                : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"
            }`}
          >
            <span className="shrink-0 text-slate-400 dark:text-slate-500">{chip.label}</span>
            <span className="truncate">{chip.value}</span>
          </span>
        ))}
      </div>

      {error && <IssueImportErrorPanel error={getIssueImportErrorCopy(error)} />}

      {loading ? (
        <IssueImportLoadingSkeletonList count={6} />
      ) : issues.length === 0 ? (
        <IssueImportEmptyState
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={(
            <button
              type="button"
              onClick={() => { void executeSearch(filters); }}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px dark:bg-white dark:text-slate-950"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search issues
            </button>
          )}
        />
      ) : (
        <div className="grid gap-3">
          {issues.map((issue) => {
            const key = issueKey(issue);
            const selected = selectedKeys.has(key);
            const conversationEnabled = !conversationDisabledKeys.has(key);
            const cardProvider = getIssueImportProviderMetadata(issue.provider === "gitlab" ? "gitlab" : "github");
            const CardIcon = issue.provider === "gitlab" ? Gitlab : Github;

            return (
              <IssueImportIssueCard
                key={key}
                provider={cardProvider}
                issueKey={issue.issueKey || `#${issue.issueNumber}`}
                title={issue.title}
                url={issue.url}
                bodyPreview={issue.bodyPreview}
                selected={selected}
                includeConversation={conversationEnabled}
                metadataRows={buildIssueImportMetadataRows({
                  provider: issue.provider === "gitlab" ? "gitlab" : "github",
                  repository: issue.repository,
                  issueKey: issue.issueKey,
                  issueNumber: issue.issueNumber,
                  state: issue.state,
                  issueAuthor: issue.issueAuthor,
                  issueMilestone: issue.issueMilestone,
                  issueCommentCount: issue.issueCommentCount,
                  createdAt: issue.createdAt,
                  updatedAt: issue.updatedAt,
                })}
                labels={truncateIssueImportLabels(issue.labels ?? [])}
                assignees={truncateIssueImportAssignees(issue.assignees ?? [])}
                selectionLabel={selected ? "Selected" : "Click to select"}
                metadataLimit={selected ? 7 : 5}
                icon={<CardIcon className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />}
                onToggle={() => toggleIssue(issue)}
                onToggleConversation={() => toggleConversation(issue)}
              />
            );
          })}
        </div>
      )}
    </div>
  );

  const footerContent = (
    <section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Selected items
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {getSelectedIssueCountLabel(visibleSelectedCount)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllVisible}
                        disabled={issues.length === 0}
                        aria-label={selectVisibleLabel}
                        className={`rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white`}
                      >
                        {allVisibleSelected ? "Deselect visible" : "Select visible"}
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        disabled={clearSelectionDisabled}
                        aria-label={clearSelectionDisabled ? "Clear selection is disabled because no issues are selected." : "Clear selected issues"}
                        className={`rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white`}
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-white/82 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={allSelectedConversationEnabled}
                      onChange={(event) => setConversationForSelection((event.target as HTMLInputElement).checked)}
                      className="h-4 w-4 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                      aria-label="Append conversation for all selected issues"
                    />
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                        Append conversation on selected
                      </div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-400">
                        Controls whether selected issue bodies are imported with their discussion history.
                      </div>
                    </div>
                  </div>

                  {selectedIssues.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedIssues.map((issue) => {
                        const key = issueKey(issue);
                        const conversationEnabled = !conversationDisabledKeys.has(key);
                        return (
                          <div
                            key={key}
                            className="rounded-[1rem] border border-black/[0.06] bg-white/82 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                  {issue.issueKey}
                                </div>
                                <div className="mt-1 line-clamp-2 text-sm font-bold text-slate-900 dark:text-white">
                                  {issue.title}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleIssue(issue)}
                                className="rounded-full border border-black/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                              >
                                Remove
                              </button>
                            </div>
                            <label className="mt-3 inline-flex items-center gap-2 rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.08] dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={conversationEnabled}
                                onChange={() => toggleConversation(issue)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                              />
                              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                              Append conversation
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[1rem] border border-dashed border-black/[0.1] px-4 py-6 text-sm text-slate-400 dark:border-white/[0.1] dark:text-slate-500">
                      Nothing selected yet.
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Import actions
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleImportLinkedIssues(); }}
                    disabled={!anySelected || importing}
                    aria-label={importLinkedLabel}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[1rem] bg-signal-500 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckSquare className="h-4 w-4" aria-hidden="true" />}
                    Import as linked issues
                  </button>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {SPECIAL_TASK_KINDS.map((taskKind) => {
                      const Icon = taskKind.icon;
                      return (
                        <button
                          key={taskKind.kind}
                          type="button"
                          onClick={() => { void handleImportSpecialTasks(taskKind.kind); }}
                          disabled={!anySelected || importing || !onImportSpecialTasks}
                          aria-label={!anySelected ? `Import as ${taskKind.label} is disabled because no issues are selected.` : `Import as ${taskKind.label}: ${visibleSelectedCount} selected issue${visibleSelectedCount === 1 ? "" : "s"}.`}
                          className={`rounded-[1rem] border px-3 py-3 text-left transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 ${providerMetadata.accent.focusRingClassName} disabled:cursor-not-allowed disabled:opacity-50 ${taskKind.tone}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} />
                            <span className="text-xs font-black uppercase tracking-[0.14em]">
                              Import as {taskKind.label}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed opacity-80">
                            {taskKind.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-[1rem] border border-black/[0.06] bg-white/82 p-3 text-[11px] leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
                    <strong className="font-bold text-slate-700 dark:text-slate-200">Tip:</strong>{" "}
                    Use the quick filters to narrow the backlog first, then bulk-select a slice for linked issue import or task conversion.
                  </div>
                </div>
              </div>
            </section>
  );

  return (
    <IssueImportShell
      provider={providerMetadata}
      title="Browse backlog and import sprint context"
      description="Search issues, select a dense batch, then import them as linked sprint context or as special remediation tasks."
      onClose={onClose}
      closeLabel="Close issue import"
      activeFilterCountLabel={compactState.activeFilterCountLabel}
      summaryRail={(
        <IssueImportSummaryRail
          provider={providerMetadata}
          title={`${providerMetadata.label} issue scope`}
          description="Tune the provider, repository, filters, and selected conversation context before importing sprint work."
          items={[
            { label: "Provider", value: providerMetadata.label },
            { label: "Host", value: filters.hostDomain || DEFAULT_HOST_BY_PROVIDER[filters.provider] },
            { label: "Repository", value: filters.repository || "Not set" },
            { label: "Selected", value: String(visibleSelectedCount) },
            { label: "Sort", value: compactState.sortLabel, active: true },
          ]}
          status={compactState.selectedCountLabel}
        />
      )}
      filters={filtersContent}
      advancedFilters={advancedFiltersContent}
      advancedFiltersExpanded={advancedFiltersExpanded}
      advancedFiltersLabel={`Advanced filters (${compactState.activeFilterCountLabel})`}
      advancedFiltersId="repository-issue-import-advanced-filters"
      onAdvancedFiltersToggle={() => setAdvancedFiltersExpanded((current) => !current)}
      footer={footerContent}
    >
      {resultsContent}
    </IssueImportShell>
  );
};

function issueKey(issue: SprintLinkedIssueInput): string {
  return `${issue.provider}:${issue.hostDomain}:${issue.repository}:${issue.issueNumber}`;
}
