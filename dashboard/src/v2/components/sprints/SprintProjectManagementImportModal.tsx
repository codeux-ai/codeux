import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Check, CheckSquare, FileText, ListTodo, Loader2, MessageSquare, Search } from "lucide-preact";
import type {
  ExternalImporterSettings,
  SprintLinkedIssueInput,
} from "../../types.js";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
  type RemoteIssueSummary,
} from "../../lib/project-api.js";
import { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";
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
import { IssueImportIssueCard } from "./importer/IssueImportIssueCard.js";
import { IssueImportSummaryRail } from "./importer/IssueImportSummaryRail.js";
import {
  IssueImportField,
  IssueImportFilterSection,
  IssueImportMultiSelectField,
  IssueImportNumberInput,
  IssueImportSelect,
  IssueImportTextInput,
} from "./importer/IssueImportFields.js";
import {
  IssueImportErrorPanel,
  IssueImportLoadingSkeletonList,
  IssueImportShell,
} from "./importer/IssueImportShell.js";

export type ProjectManagementImportProvider = Extract<IssueImportProvider, "notion" | "asana" | "linear">;

interface SprintProjectManagementImportModalProps {
  projectId: string;
  provider: ProjectManagementImportProvider;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void | Promise<void>;
}

interface ProjectManagementFilters {
  search: string;
  databaseId: string;
  workspaceId: string;
  providerProjectId: string;
  teamId: string;
  teamKey: string;
  state: string;
  status: "open" | "in_progress" | "done" | "all";
  labels: string[];
  assignee: string;
  externalIds: string[];
  limit: number;
}

interface ProviderConfig {
  provider: ProjectManagementImportProvider;
  title: string;
  description: string;
  searchPlaceholder: string;
  defaultStatus: ProjectManagementFilters["status"];
  supportsDatabase: boolean;
  supportsWorkspace: boolean;
  supportsProject: boolean;
  supportsTeam: boolean;
  supportsState: boolean;
  supportsStatus: boolean;
  supportsLabels: boolean;
  supportsAssignee: boolean;
  resultNounSingular: string;
  resultNounPlural: string;
}

const PROVIDER_CONFIGS: Record<ProjectManagementImportProvider, ProviderConfig> = {
  notion: {
    provider: "notion",
    title: "Import Notion Scope",
    description: "Search Notion pages and databases, select readable scope, then attach it to the sprint composer.",
    searchPlaceholder: "Page, database, or content text",
    defaultStatus: "all",
    supportsDatabase: true,
    supportsWorkspace: false,
    supportsProject: false,
    supportsTeam: false,
    supportsState: false,
    supportsStatus: false,
    supportsLabels: false,
    supportsAssignee: false,
    resultNounSingular: "item",
    resultNounPlural: "items",
  },
  asana: {
    provider: "asana",
    title: "Import Asana Tasks",
    description: "Search Asana workspace or project tasks, select work items, then attach them as linked sprint scope.",
    searchPlaceholder: "Task title, notes, or task GID",
    defaultStatus: "open",
    supportsDatabase: false,
    supportsWorkspace: true,
    supportsProject: true,
    supportsTeam: false,
    supportsState: false,
    supportsStatus: true,
    supportsLabels: true,
    supportsAssignee: true,
    resultNounSingular: "task",
    resultNounPlural: "tasks",
  },
  linear: {
    provider: "linear",
    title: "Import Linear Issues",
    description: "Search Linear teams, projects, states, labels, and assignees, then attach selected issues to the sprint composer.",
    searchPlaceholder: "Issue title, description, or LIN-42",
    defaultStatus: "open",
    supportsDatabase: false,
    supportsWorkspace: false,
    supportsProject: true,
    supportsTeam: true,
    supportsState: true,
    supportsStatus: true,
    supportsLabels: true,
    supportsAssignee: true,
    resultNounSingular: "issue",
    resultNounPlural: "issues",
  },
};

const STATUS_OPTIONS: Array<{ value: ProjectManagementFilters["status"]; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

const DEFAULT_FILTERS: ProjectManagementFilters = {
  search: "",
  databaseId: "",
  workspaceId: "",
  providerProjectId: "",
  teamId: "",
  teamKey: "",
  state: "",
  status: "open",
  labels: [],
  assignee: "",
  externalIds: [],
  limit: 40,
};

export const SprintProjectManagementImportModal: FunctionComponent<SprintProjectManagementImportModalProps> = ({
  projectId,
  provider,
  onClose,
  onImport,
}) => {
  const config = PROVIDER_CONFIGS[provider];
  const providerMetadata = getIssueImportProviderMetadata(provider);
  const [filters, setFilters] = useState<ProjectManagementFilters>({
    ...DEFAULT_FILTERS,
    status: config.defaultStatus,
  });
  const [initialFilters, setInitialFilters] = useState<ProjectManagementFilters>({
    ...DEFAULT_FILTERS,
    status: config.defaultStatus,
  });
  const [results, setResults] = useState<RemoteIssueSummary[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectedResults = useMemo(
    () => results.filter((result) => selectedKeys.has(resultKey(result))),
    [results, selectedKeys],
  );
  const anySelected = selectedResults.length > 0;
  const allVisibleSelected = results.length > 0 && selectedResults.length === results.length;
  const allSelectedConversationEnabled = anySelected
    && selectedResults.every((result) => !conversationDisabledKeys.has(resultKey(result)));
  const emptyCopy = getIssueImportEmptyStateCopy(provider, hasSearched);

  const runSearch = useCallback(async (query: ProjectManagementFilters): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const data = await searchProjectIssues(projectId, {
        provider,
        search: normalizeOptionalText(query.search),
        databaseId: config.supportsDatabase ? normalizeOptionalText(query.databaseId) : undefined,
        workspaceId: config.supportsWorkspace ? normalizeOptionalText(query.workspaceId) : undefined,
        providerProjectId: config.supportsProject ? normalizeOptionalText(query.providerProjectId) : undefined,
        teamId: config.supportsTeam ? normalizeOptionalText(query.teamId) : undefined,
        teamKey: config.supportsTeam ? normalizeOptionalText(query.teamKey) : undefined,
        state: config.supportsState ? normalizeOptionalText(query.state) : undefined,
        status: config.supportsStatus ? query.status : undefined,
        labels: config.supportsLabels ? query.labels : [],
        assignee: config.supportsAssignee ? normalizeOptionalText(query.assignee) : undefined,
        externalIds: query.externalIds,
        limit: query.limit,
      }, controller.signal);
      setResults(data);
      pruneSelectionToResults(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const copy = getIssueImportErrorCopy(err, `${providerMetadata.label} search failed. Check Settings -> Integrations and try again.`);
      setError(copy.message);
      setResults([]);
      pruneSelectionToResults([]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [config, projectId, provider, providerMetadata.label]);

  useEffect(() => {
    let cancelled = false;
    const loadDefaults = async (): Promise<void> => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        if (cancelled) {
          return;
        }
        const settings = effective.settings[provider] as ExternalImporterSettings;
        const nextFilters = filtersFromSettings(config, settings);
        setFilters(nextFilters);
        setInitialFilters(nextFilters);
        await runSearch(nextFilters);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const copy = getIssueImportErrorCopy(err, `Failed to load ${providerMetadata.label} defaults from Settings -> Integrations.`);
        setError(copy.message);
        setHasSearched(true);
      }
    };
    void loadDefaults();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [config, projectId, provider, providerMetadata.label, runSearch]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const updateFilters = useCallback((updater: (current: ProjectManagementFilters) => ProjectManagementFilters): void => {
    setFilters((current) => updater(current));
  }, []);

  const toggleResult = useCallback((result: RemoteIssueSummary): void => {
    const key = resultKey(result);
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

  const toggleConversation = useCallback((result: RemoteIssueSummary): void => {
    const key = resultKey(result);
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

  const selectAllVisible = useCallback((): void => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        for (const result of results) {
          next.delete(resultKey(result));
        }
        return next;
      }
      const next = new Set(current);
      for (const result of results) {
        next.add(resultKey(result));
      }
      return next;
    });
  }, [allVisibleSelected, results]);

  const clearSelection = useCallback((): void => {
    setSelectedKeys(new Set());
    setConversationDisabledKeys(new Set());
  }, []);

  const setConversationForSelection = useCallback((enabled: boolean): void => {
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      for (const result of selectedResults) {
        const key = resultKey(result);
        if (enabled) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }, [selectedResults]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (selectedResults.length === 0) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const contexts = await fetchProjectIssuePromptContexts(projectId, selectedResults.map((result) => ({
        ...result,
        includeConversation: !conversationDisabledKeys.has(resultKey(result)),
      })));
      await onImport(contexts);
      onClose();
    } catch (err) {
      const copy = getIssueImportErrorCopy(err, `${providerMetadata.label} import failed. Try again after checking the selected items.`);
      setError(copy.message);
    } finally {
      setImporting(false);
    }
  }, [conversationDisabledKeys, onClose, onImport, projectId, providerMetadata.label, selectedResults]);

  const compactState = buildIssueImportCompactState({
    filters: [
      { id: "provider", label: "Provider", value: providerMetadata.label, alwaysShow: true, priority: 0 },
      { id: "database", label: "Database", value: filters.databaseId, defaultValue: initialFilters.databaseId, alwaysShow: config.supportsDatabase, priority: 1 },
      { id: "workspace", label: "Workspace", value: filters.workspaceId, defaultValue: initialFilters.workspaceId, alwaysShow: config.supportsWorkspace, priority: 2 },
      { id: "project", label: "Project", value: filters.providerProjectId, defaultValue: initialFilters.providerProjectId, alwaysShow: config.supportsProject, priority: 3 },
      { id: "teamKey", label: "Team", value: filters.teamKey || filters.teamId, defaultValue: initialFilters.teamKey || initialFilters.teamId, alwaysShow: config.supportsTeam, priority: 4 },
      { id: "search", label: "Search", value: filters.search, priority: 5 },
      { id: "state", label: "State", value: filters.state, defaultValue: initialFilters.state, alwaysShow: config.supportsState, priority: 6 },
      { id: "status", label: "Status", value: filters.status, defaultValue: config.defaultStatus, valueLabel: getStatusLabel(filters.status), alwaysShow: config.supportsStatus, priority: 7 },
      { id: "labels", label: "Labels", value: filters.labels, priority: 8 },
      { id: "assignee", label: "Assignee", value: filters.assignee, priority: 9 },
      { id: "externalIds", label: "External IDs", value: filters.externalIds, priority: 10 },
      { id: "limit", label: "Limit", value: filters.limit, defaultValue: initialFilters.limit, defaultLabel: `${initialFilters.limit} results`, alwaysShow: true, priority: 11 },
    ],
    selectedCount: selectedResults.length,
    visibleCount: results.length,
    totalCount: results.length,
    resultNounSingular: config.resultNounSingular,
    resultNounPlural: config.resultNounPlural,
  });

  const selectVisibleLabel = allVisibleSelected ? "Deselect all visible results" : "Select all visible results";
  const selectedCountLabel = getSelectedIssueCountLabel(selectedResults.length).replace(/issues/g, config.resultNounPlural).replace(/issue/g, config.resultNounSingular);

  return (
    <IssueImportShell
      provider={providerMetadata}
      title={config.title}
      description={config.description}
      onClose={onClose}
      closeLabel={`Close ${providerMetadata.label} import`}
      activeFilterCountLabel={compactState.activeFilterCountLabel}
      summaryRail={(
        <IssueImportSummaryRail
          provider={providerMetadata}
          title={`${providerMetadata.label} linked scope`}
          description="Select external work items, control conversation context, and import through the shared linked issue path."
          items={[
            { label: "Provider", value: providerMetadata.label },
            { label: "Search", value: filters.search || "All readable items" },
            { label: "Visible", value: String(results.length) },
            { label: "Selected", value: String(selectedResults.length), active: selectedResults.length > 0 },
            { label: "Limit", value: String(filters.limit) },
          ]}
          status={compactState.selectedCountLabel}
        />
      )}
      filters={(
        <div className="grid gap-4">
          <IssueImportFilterSection
            title={`${providerMetadata.label} search`}
            description="Default search uses saved project-effective integration settings and a bounded result limit."
            compact
            action={(
              <button
                type="button"
                onClick={() => { void runSearch(filters); }}
                disabled={loading}
                className={`inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-[1rem] px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.selectedIconClassName}`}
                aria-label={loading ? `Search ${providerMetadata.label} is loading` : `Search ${providerMetadata.label}`}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                Search
              </button>
            )}
          >
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(16rem,1.5fr)_repeat(2,minmax(9rem,0.75fr))]">
              <IssueImportField label="Search text">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.search}
                    onInput={(event) => updateFilters((current) => ({ ...current, search: (event.target as HTMLInputElement).value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch(filters);
                      }
                    }}
                    placeholder={config.searchPlaceholder}
                    className="pl-10"
                    aria-label={`${providerMetadata.label} search text`}
                  />
                </div>
              </IssueImportField>

              {config.supportsStatus && (
                <IssueImportField label="Status">
                  <IssueImportSelect
                    provider={providerMetadata}
                    aria-label={`${providerMetadata.label} status`}
                    value={filters.status}
                    onChange={(value) => updateFilters((current) => ({ ...current, status: value as ProjectManagementFilters["status"] }))}
                    options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </IssueImportField>
              )}

              <IssueImportField label="Limit" hint="Bounded to the shared issue search endpoint limit.">
                <IssueImportNumberInput
                  provider={providerMetadata}
                  min={1}
                  max={100}
                  value={filters.limit}
                  onInput={(event) => updateFilters((current) => ({
                    ...current,
                    limit: normalizeLimit((event.target as HTMLInputElement).value, current.limit),
                  }))}
                  aria-label={`${providerMetadata.label} result limit`}
                />
              </IssueImportField>
            </div>
          </IssueImportFilterSection>
        </div>
      )}
      advancedFilters={(
        <div className="grid gap-4">
          <IssueImportFilterSection
            title="Provider scope"
            description="Use saved defaults or override the exact workspace, project, database, or team target for this search."
            compact
          >
            <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {config.supportsDatabase && (
                <IssueImportField label="Database ID" hint="Optional. Narrows Notion search to one database parent.">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.databaseId}
                    onInput={(event) => updateFilters((current) => ({ ...current, databaseId: (event.target as HTMLInputElement).value }))}
                    placeholder="database-id"
                    aria-label="Notion database ID"
                  />
                </IssueImportField>
              )}
              {config.supportsWorkspace && (
                <IssueImportField label="Workspace ID" hint="Required for Asana workspace search unless project ID is supplied.">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.workspaceId}
                    onInput={(event) => updateFilters((current) => ({ ...current, workspaceId: (event.target as HTMLInputElement).value }))}
                    placeholder="workspace-gid"
                    aria-label="Asana workspace ID"
                  />
                </IssueImportField>
              )}
              {config.supportsProject && (
                <IssueImportField label="Project ID">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.providerProjectId}
                    onInput={(event) => updateFilters((current) => ({ ...current, providerProjectId: (event.target as HTMLInputElement).value }))}
                    placeholder={provider === "asana" ? "project-gid" : "linear-project-id"}
                    aria-label={`${providerMetadata.label} project ID`}
                  />
                </IssueImportField>
              )}
              {config.supportsTeam && (
                <>
                  <IssueImportField label="Team ID">
                    <IssueImportTextInput
                      provider={providerMetadata}
                      value={filters.teamId}
                      onInput={(event) => updateFilters((current) => ({ ...current, teamId: (event.target as HTMLInputElement).value }))}
                      placeholder="team-id"
                      aria-label="Linear team ID"
                    />
                  </IssueImportField>
                  <IssueImportField label="Team key">
                    <IssueImportTextInput
                      provider={providerMetadata}
                      value={filters.teamKey}
                      onInput={(event) => updateFilters((current) => ({ ...current, teamKey: (event.target as HTMLInputElement).value.toUpperCase() }))}
                      placeholder="LIN"
                      aria-label="Linear team key"
                    />
                  </IssueImportField>
                </>
              )}
              {config.supportsState && (
                <IssueImportField label="Workflow state" hint="Optional Linear state name, such as Triage or In Progress.">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.state}
                    onInput={(event) => updateFilters((current) => ({ ...current, state: (event.target as HTMLInputElement).value }))}
                    placeholder="In Progress"
                    aria-label="Linear workflow state"
                  />
                </IssueImportField>
              )}
            </div>
          </IssueImportFilterSection>

          {(config.supportsLabels || config.supportsAssignee) && (
            <IssueImportFilterSection
              title="People and labels"
              description="Narrow Asana and Linear results by supported provider metadata."
              compact
            >
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {config.supportsLabels && (
                  <IssueImportMultiSelectField label="Labels">
                    <MultiSelect
                      value={filters.labels}
                      onChange={(labels) => updateFilters((current) => ({ ...current, labels }))}
                      placeholder="triage, backend"
                    />
                  </IssueImportMultiSelectField>
                )}
                {config.supportsAssignee && (
                  <IssueImportField label="Assignee">
                    <IssueImportTextInput
                      provider={providerMetadata}
                      value={filters.assignee}
                      onInput={(event) => updateFilters((current) => ({ ...current, assignee: (event.target as HTMLInputElement).value }))}
                      placeholder={provider === "linear" ? "Name, display name, or email" : "Asana assignee GID"}
                      aria-label={`${providerMetadata.label} assignee`}
                    />
                  </IssueImportField>
                )}
              </div>
            </IssueImportFilterSection>
          )}

          <IssueImportFilterSection
            title="Explicit external IDs"
            description="Use exact Notion object IDs, Asana task GIDs, or Linear issue IDs/identifiers when search text is too broad."
            compact
          >
            <IssueImportMultiSelectField label="External IDs">
              <MultiSelect
                value={filters.externalIds}
                onChange={(externalIds) => updateFilters((current) => ({ ...current, externalIds }))}
                placeholder={provider === "linear" ? "LIN-42, issue-id" : "External object ID"}
              />
            </IssueImportMultiSelectField>
          </IssueImportFilterSection>
        </div>
      )}
      advancedFiltersExpanded={advancedFiltersExpanded}
      advancedFiltersLabel={`Advanced ${providerMetadata.label} filters`}
      advancedFiltersId={`${provider}-import-advanced-filters`}
      onAdvancedFiltersToggle={() => setAdvancedFiltersExpanded((current) => !current)}
      resultStatus={(
        <div className="flex flex-col gap-3 rounded-[1.1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="font-black text-slate-700 dark:text-slate-200">{results.length}</span>{" "}
              visible {config.resultNounPlural}.
              {" "}
              <span className="font-black text-slate-700 dark:text-slate-200">{selectedResults.length}</span>{" "}
              selected.
            </div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              {compactState.activeFilterCountLabel}
            </div>
          </div>
          {compactState.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={`Active ${providerMetadata.label} filters`}>
              {compactState.chips.map((chip) => (
                <span
                  key={chip.id}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${
                    chip.active
                      ? providerMetadata.accent.badgeClassName
                      : "bg-black/[0.035] text-slate-500 ring-black/[0.05] dark:bg-white/[0.05] dark:text-slate-300 dark:ring-white/[0.06]"
                  }`}
                >
                  <span className="text-slate-400 dark:text-slate-500">{chip.label}</span>
                  <span className="truncate">{chip.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      footer={(
        <div className="flex flex-col gap-4 rounded-[1.4rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-xs font-semibold text-slate-400" aria-live="polite">
              <span className="font-bold text-slate-600 dark:text-slate-200">{selectedCountLabel}</span>{" "}
              {selectedResults.length} of {results.length} visible {config.resultNounPlural} selected.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={results.length === 0 || loading}
                className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                aria-label={selectVisibleLabel}
              >
                {allVisibleSelected ? "Deselect visible" : "Select all visible"}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!anySelected}
                className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                aria-label={anySelected ? "Clear selection" : "Clear selection is disabled because no items are selected"}
              >
                Clear selection
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white">
              <input
                type="checkbox"
                checked={allSelectedConversationEnabled}
                disabled={!anySelected}
                onChange={(event) => setConversationForSelection((event.target as HTMLInputElement).checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                aria-label={`Append conversation to all selected ${providerMetadata.label} items`}
              />
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
              Append conversation to selected
            </label>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className={`rounded-[1rem] border border-black/[0.06] px-5 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleImport(); }}
                disabled={!anySelected || importing}
                className={`rounded-[1rem] px-5 py-3 text-sm font-semibold shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.selectedIconClassName}`}
                aria-label={!anySelected ? `Import ${providerMetadata.label} items disabled until items are selected` : `Import ${providerMetadata.label} items`}
              >
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {error && <IssueImportErrorPanel error={getIssueImportErrorCopy(error)} />}

      {loading ? (
        <IssueImportLoadingSkeletonList count={6} />
      ) : hasSearched && results.length === 0 ? (
        <IssueImportEmptyState
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={(
            <button
              type="button"
              onClick={() => { void runSearch(filters); }}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition-all hover:-translate-y-px ${providerMetadata.accent.selectedIconClassName}`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search again
            </button>
          )}
        />
      ) : (
        <div className="grid gap-3">
          {results.map((result) => {
            const key = resultKey(result);
            const selected = selectedKeys.has(key);
            const conversationEnabled = !conversationDisabledKeys.has(key);
            return (
              <IssueImportIssueCard
                key={key}
                provider={providerMetadata}
                issueKey={result.issueKey || result.externalId || result.url}
                title={result.title}
                url={result.url}
                bodyPreview={result.bodyPreview}
                selected={selected}
                includeConversation={conversationEnabled}
                metadataRows={buildIssueImportMetadataRows({
                  provider,
                  sourceProvider: result.sourceProvider,
                  sourceKind: result.sourceKind,
                  externalId: result.externalId,
                  repository: result.repository,
                  projectKey: result.projectKey,
                  issueKey: result.issueKey,
                  issueNumber: result.issueNumber,
                  state: result.state,
                  issueType: result.issueType,
                  priority: result.issuePriority,
                  issueAuthor: result.issueAuthor,
                  issueReporter: result.issueReporter,
                  issueMilestone: result.issueMilestone,
                  issueCommentCount: result.issueCommentCount,
                  createdAt: result.createdAt,
                  updatedAt: result.updatedAt,
                })}
                labels={truncateIssueImportLabels(result.labels ?? [], 6)}
                assignees={truncateIssueImportAssignees(result.assignees ?? [], 4)}
                selectionLabel={selected ? "Selected" : "Click to select"}
                modeLabel="Linked scope"
                icon={<ProviderResultIcon provider={provider} />}
                metadataLimit={selected ? 7 : 5}
                onToggle={() => toggleResult(result)}
                onToggleConversation={() => toggleConversation(result)}
              />
            );
          })}
        </div>
      )}
    </IssueImportShell>
  );

  function pruneSelectionToResults(nextResults: ReadonlyArray<RemoteIssueSummary>): void {
    const visibleKeys = new Set(nextResults.map((result) => resultKey(result)));
    setSelectedKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
    setConversationDisabledKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
  }
};

const ProviderResultIcon: FunctionComponent<{ provider: ProjectManagementImportProvider }> = ({ provider }) => {
  if (provider === "notion") {
    return <FileText className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
  }
  if (provider === "asana") {
    return <CheckSquare className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
  }
  return <ListTodo className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
};

function filtersFromSettings(
  config: ProviderConfig,
  settings: ExternalImporterSettings,
): ProjectManagementFilters {
  const limit = Number.isFinite(settings.defaultSearchLimit)
    ? Math.max(1, Math.min(100, Math.trunc(settings.defaultSearchLimit)))
    : 40;
  return {
    ...DEFAULT_FILTERS,
    status: config.defaultStatus,
    databaseId: config.supportsDatabase ? settings.databaseId || "" : "",
    workspaceId: config.supportsWorkspace ? settings.workspaceId || "" : "",
    providerProjectId: config.supportsProject ? settings.projectId || "" : "",
    teamId: config.supportsTeam ? settings.teamId || "" : "",
    teamKey: config.supportsTeam ? settings.teamKey || "" : "",
    limit,
  };
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLimit(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : fallback;
}

function getStatusLabel(value: ProjectManagementFilters["status"]): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function resultKey(result: RemoteIssueSummary): string {
  return [
    result.provider,
    result.sourceProvider || "",
    result.externalId || result.issueKey || "",
    result.hostDomain,
    result.repository,
    result.issueNumber ?? "",
    result.url,
  ].join("::");
}
