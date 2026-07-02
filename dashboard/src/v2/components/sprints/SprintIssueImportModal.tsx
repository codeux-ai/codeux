import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowUpDown,
  Check,
  CalendarDays,
  Clock3,
  ExternalLink,
  Filter,
  Github,
  Gitlab,
  Loader2,
  MessageSquare,
  Search,
  Shield,
  GitMerge,
  Tag,
  User,
  Users,
  Square,
  CheckSquare,
  X,
} from "lucide-preact";
import type {
  ProjectSummary,
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
} from "../../types.js";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
  type RemoteIssueSummary,
} from "../../lib/project-api.js";
import { MultiSelect } from "../ui/MultiSelect.js";
import { getSafeUrl } from "../../lib/safe-url.js";

interface SprintIssueImportModalProps {
  project: ProjectSummary;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void | Promise<void>;
  onImportSpecialTasks?: (tasks: SprintImportedTaskInput[]) => void | Promise<void>;
}

interface IssueFilters {
  provider: "github" | "gitlab";
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

const STATE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

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

const inferRepository = (project: ProjectSummary): string => {
  const source = project.repoUrl || project.sourceRef || "";
  const cleaned = source.trim().replace(/\.git$/i, "").replace(/\/+$/g, "");
  if (!cleaned) return "";
  const httpsMatch = cleaned.match(/^https?:\/\/[^/]+\/(.+)$/i);
  if (httpsMatch) return httpsMatch[1] || "";
  const sshMatch = cleaned.match(/^[^@]+@[^:/]+[:/](.+)$/i);
  if (sshMatch) return sshMatch[1] || "";
  return "";
};

const inferHostDomain = (project: ProjectSummary, provider: "github" | "gitlab"): string => {
  if (project.gitHostDomain?.trim()) {
    return project.gitHostDomain.trim();
  }
  return provider === "gitlab" ? "gitlab.com" : "github.com";
};

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
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

const getProviderAccent = (provider: "github" | "gitlab"): string => (
  provider === "gitlab"
    ? "border-ember-500/20 bg-ember-500/10 text-ember-600 dark:text-ember-400"
    : "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300"
);

export const SprintIssueImportModal: FunctionComponent<SprintIssueImportModalProps> = ({
  project,
  onClose,
  onImport,
  onImportSpecialTasks,
}) => {
  const initialProvider: "github" | "gitlab" = project.gitProvider === "gitlab" ? "gitlab" : "github";
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
  const [lastPreset, setLastPreset] = useState<string | null>(null);
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
      setError("Repository is required.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
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

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 px-3 py-4 backdrop-blur-xl dark:bg-black/75 sm:px-4 sm:py-6">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_48px_120px_rgba(15,23,42,0.28)] dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_48px_120px_rgba(0,0,0,0.72)]">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] px-4 py-4 sm:px-6 sm:py-5 dark:border-white/[0.06]">
          <div className="min-w-0">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${getProviderAccent(filters.provider)}`}>
              {filters.provider === "github" ? <Github className="h-3.5 w-3.5" strokeWidth={2.1} /> : <Gitlab className="h-3.5 w-3.5" strokeWidth={2.1} />}
              {filters.provider === "github" ? "GitHub" : "GitLab"} issue import
            </div>
            <h2 className="mt-3 font-display text-2xl font-black leading-none text-slate-900 dark:text-white sm:text-3xl">
              Browse backlog and import sprint context
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Search issues, select a dense batch, then import them as linked sprint context or as special remediation tasks.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 transition-colors hover:bg-black/[0.08] hover:text-slate-900 dark:bg-white/[0.05] dark:hover:text-white"
              aria-label="Close issue import"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-black/[0.06] bg-black/[0.015] px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.025] lg:border-b-0 lg:border-r lg:px-5 lg:py-5">
            <div className="space-y-5">
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <Filter className="h-3.5 w-3.5" />
                  Provider
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["github", "gitlab"] as const).map((provider) => {
                    const Icon = provider === "github" ? Github : Gitlab;
                    const active = filters.provider === provider;
                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => updateFilters((current) => ({
                          ...current,
                          provider,
                          hostDomain: inferHostDomain(project, provider),
                        }))}
                        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[1rem] border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all ${
                          active
                            ? provider === "gitlab"
                              ? "border-ember-500/25 bg-ember-500/10 text-ember-600 dark:text-ember-400"
                              : "border-signal-500/25 bg-signal-500/10 text-signal-600 dark:text-signal-300"
                            : "border-black/[0.07] bg-white/80 text-slate-500 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-white"
                        }`}
                        aria-pressed={active}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                        {provider}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Repository target
                </div>
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Host</span>
                  <input
                    value={filters.hostDomain}
                    onInput={(event) => updateFilters((current) => ({ ...current, hostDomain: (event.target as HTMLInputElement).value }))}
                    className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    placeholder="github.com"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Repository</span>
                  <input
                    value={filters.repository}
                    onInput={(event) => updateFilters((current) => ({ ...current, repository: (event.target as HTMLInputElement).value }))}
                    className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    placeholder="owner/repository"
                  />
                </label>
              </section>

              <section className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Quick filters
                </div>
                <div className="grid gap-2">
                  {quickFilterPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => { void applyPreset(preset); }}
                      className={`rounded-[1rem] border px-3 py-2.5 text-left transition-colors ${
                        lastPreset === preset.id
                          ? "border-signal-500/25 bg-signal-500/[0.08] text-slate-900 dark:text-white"
                          : "border-black/[0.06] bg-white/76 text-slate-600 hover:border-black/[0.12] hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="text-xs font-bold">{preset.label}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Search filters
                </div>
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Search</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={filters.search}
                      onInput={(event) => updateFilters((current) => ({ ...current, search: (event.target as HTMLInputElement).value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void executeSearch(filters);
                        }
                      }}
                      placeholder="Title, body, or issue text"
                      className="h-11 w-full rounded-[1rem] border border-black/[0.07] bg-black/[0.025] pl-10 pr-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </div>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">State</span>
                    <select
                      value={filters.state}
                      onChange={(event) => updateFilters((current) => ({ ...current, state: (event.target as HTMLSelectElement).value as IssueFilters["state"] }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {STATE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Limit</span>
                    <select
                      value={filters.limit}
                      onChange={(event) => updateFilters((current) => ({ ...current, limit: Number((event.target as HTMLSelectElement).value) }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {SEARCH_LIMITS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <MultiSelect
                  value={filters.labels}
                  onChange={(labels) => updateFilters((current) => ({ ...current, labels }))}
                  placeholder="Labels"
                />

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Assignee</span>
                    <input
                      value={filters.assignee}
                      onInput={(event) => updateFilters((current) => ({ ...current, assignee: (event.target as HTMLInputElement).value }))}
                      placeholder="me or username"
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Author</span>
                    <input
                      value={filters.author}
                      onInput={(event) => updateFilters((current) => ({ ...current, author: (event.target as HTMLInputElement).value }))}
                      placeholder="author text"
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Milestone</span>
                    <input
                      value={filters.milestone}
                      onInput={(event) => updateFilters((current) => ({ ...current, milestone: (event.target as HTMLInputElement).value }))}
                    placeholder="release milestone"
                    className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Updated after
                    </span>
                    <input
                      type="date"
                      value={filters.updatedAfter}
                      onChange={(event) => updateFilters((current) => ({ ...current, updatedAfter: (event.target as HTMLInputElement).value }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      <Clock3 className="h-3.5 w-3.5" />
                      Updated before
                    </span>
                    <input
                      type="date"
                      value={filters.updatedBefore}
                      onChange={(event) => updateFilters((current) => ({ ...current, updatedBefore: (event.target as HTMLInputElement).value }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      Sort
                    </span>
                    <select
                      value={filters.sortField}
                      onChange={(event) => updateFilters((current) => ({ ...current, sortField: (event.target as HTMLSelectElement).value as IssueFilters["sortField"] }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {SORT_FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      Direction
                    </span>
                    <select
                      value={filters.sortDirection}
                      onChange={(event) => updateFilters((current) => ({ ...current, sortDirection: (event.target as HTMLSelectElement).value as IssueFilters["sortDirection"] }))}
                      className="h-11 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => { void executeSearch(filters); }}
                  disabled={loading}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[1rem] bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Search issues
                </button>
              </section>
            </div>
          </aside>

          <main className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 text-xs text-slate-500 dark:border-white/[0.06] dark:text-slate-400 sm:px-6">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <CheckSquare className="h-3.5 w-3.5" />
                  {issues.length} result{issues.length === 1 ? "" : "s"}
                </span>
                {selectedIssues.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
                    <Check className="h-3.5 w-3.5" />
                    {selectedIssues.length} selected
                  </span>
                )}
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                >
                  {allVisibleSelected ? "Deselect visible" : "Select visible"}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {error && (
                <div className="mb-4 rounded-[1rem] border border-status-red/20 bg-status-red/[0.08] px-4 py-3 text-sm font-semibold text-status-red">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-28 animate-pulse rounded-[1.25rem] bg-black/[0.04] dark:bg-white/[0.04]" />
                  ))}
                </div>
              ) : issues.length === 0 ? (
                <div className="flex min-h-[14rem] items-center justify-center rounded-[1.5rem] border border-dashed border-black/[0.1] px-8 text-center text-sm font-semibold text-slate-400 dark:border-white/[0.1]">
                  No issues found for the current filters.
                </div>
              ) : (
                <div className="grid gap-3">
                  {issues.map((issue) => {
                    const key = issueKey(issue);
                    const selected = selectedKeys.has(key);
                    const ProviderIcon = issue.provider === "gitlab" ? Gitlab : Github;
                    const conversationEnabled = !conversationDisabledKeys.has(key);

                    return (
                      <article
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleIssue(issue)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleIssue(issue);
                          }
                        }}
                        className={`group rounded-[1.35rem] border p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
                          selected
                            ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_14px_32px_rgba(0,224,160,0.08)]"
                            : "border-black/[0.06] bg-white/80 hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.055]"
                        }`}
                      >
                        <div className="flex items-start gap-3 sm:gap-4">
                          <label
                            className={`mt-0.5 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[0.85rem] border transition-colors ${
                              selected
                                ? "border-signal-500/30 bg-signal-500 text-slate-950"
                                : "border-black/[0.06] bg-slate-900/[0.05] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-300"
                            }`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleIssue(issue)}
                              className="sr-only"
                              aria-label={`Select ${issue.title}`}
                            />
                            {selected ? <Check className="h-4 w-4" strokeWidth={2.6} /> : <Square className="h-4 w-4" strokeWidth={2.2} />}
                          </label>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                              <span className="inline-flex items-center gap-1">
                                <ProviderIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                                {issue.repository}
                              </span>
                              <span className="text-signal-600 dark:text-signal-300">{issue.issueKey}</span>
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${issue.state === "closed" ? "border-status-red/20 bg-status-red/10 text-status-red" : "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300"}`}>
                                {issue.state}
                              </span>
                              {issue.issueCommentCount !== null && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                                  <MessageSquare className="h-3 w-3" strokeWidth={2.2} />
                                  {issue.issueCommentCount}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 text-sm font-black leading-snug text-slate-900 dark:text-white sm:text-[1.02rem]">
                              {issue.title}
                            </div>

                            <div className="mt-2 grid gap-3">
                              <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="inline-flex items-center gap-1.5">
                                  <User className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} />
                                  <span className="truncate">{issue.issueAuthor || "Unknown author"}</span>
                                </div>
                                <div className="inline-flex items-center gap-1.5">
                                  <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} />
                                  <span className="truncate">{issue.assignees?.length ? issue.assignees.join(", ") : "No assignees"}</span>
                                </div>
                                <div className="inline-flex items-center gap-1.5">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} />
                                  <span className="truncate">Created {formatTimestamp(issue.createdAt)}</span>
                                </div>
                                <div className="inline-flex items-center gap-1.5">
                                  <Clock3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} />
                                  <span className="truncate">Updated {formatTimestamp(issue.updatedAt)}</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-1.5">
                                {(issue.labels || []).slice(0, 8).map((label) => (
                                  <span
                                    key={label}
                                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]"
                                  >
                                    <Tag className="h-3 w-3 shrink-0" strokeWidth={2} />
                                    <span className="truncate">{label}</span>
                                  </span>
                                ))}
                                {issue.issueMilestone && (
                                  <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-black/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.05] dark:text-slate-300 dark:ring-white/[0.06]">
                                    <span className="truncate">Milestone: {issue.issueMilestone}</span>
                                  </span>
                                )}
                              </div>

                              {issue.bodyPreview && (
                                <p className="line-clamp-2 max-w-4xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                  {issue.bodyPreview}
                                </p>
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <label
                                  className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={conversationEnabled}
                                    onChange={() => toggleConversation(issue)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                                    aria-label={`Append conversation for ${issue.title}`}
                                  />
                                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                                  Append conversation
                                </label>

                                <a
                                  href={getSafeUrl(issue.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                                  aria-label={`Open ${issue.title}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.1} />
                                  Source
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <section className="border-t border-black/[0.06] bg-black/[0.012] px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.025] sm:px-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Selected items
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {visibleSelectedCount === 0
                          ? "Select issues to prepare linked issue imports or special task conversions."
                          : `${visibleSelectedCount} issue${visibleSelectedCount === 1 ? "" : "s"} queued for import.`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllVisible}
                        className="rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                      >
                        {allVisibleSelected ? "Deselect visible" : "Select visible"}
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="rounded-full border border-black/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                      >
                        Clear all
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
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[1rem] bg-signal-500 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-slate-950 transition-all hover:-translate-y-px hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
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
                          className={`rounded-[1rem] border px-3 py-3 text-left transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${taskKind.tone}`}
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
          </main>
        </div>
      </div>
    </div>
  );
};

function issueKey(issue: SprintLinkedIssueInput): string {
  return `${issue.provider}:${issue.hostDomain}:${issue.repository}:${issue.issueNumber}`;
}
