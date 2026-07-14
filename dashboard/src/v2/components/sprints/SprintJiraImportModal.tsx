import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Loader2, MessageSquare, Search } from "lucide-preact";
import { JiraIcon } from "../icons/JiraIcon.js";
import type {
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
} from "../../types.js";
import {
  type JiraIssueSearchResult,
  type JiraProjectStatus,
  fetchJiraProjectStatuses,
  fetchProjectIssuePromptContexts,
  searchJiraIssues,
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
} from "../../lib/issue-import-view-models.js";
import { IssueImportEmptyState } from "./importer/IssueImportEmptyState.js";
import { IssueImportIssueCard } from "./importer/IssueImportIssueCard.js";
import { IssueImportSummaryRail } from "./importer/IssueImportSummaryRail.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";
import { translateDashboardMessage, type DashboardLocale } from "../../i18n/locales.js";
import {
  IssueImportDateInput,
  IssueImportField,
  IssueImportFilterSection,
  IssueImportMultiSelectField,
  IssueImportNumberInput,
  IssueImportSelect,
  IssueImportTextarea,
  IssueImportTextInput,
} from "./importer/IssueImportFields.js";
import {
  IssueImportErrorPanel,
  IssueImportLoadingSkeletonList,
  IssueImportShell,
} from "./importer/IssueImportShell.js";

interface SprintJiraImportModalProps {
  projectId: string;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void;
  onImportSpecialTasks?: (tasks: SprintImportedTaskInput[]) => void;
}

type JiraStatusFilter = "open" | "in_progress" | "done" | "all";
type JiraSortField = "updated" | "created" | "priority" | "status" | "assignee" | "reporter";
type JiraSortDirection = "desc" | "asc";
type ImportedTaskMode = "linked" | SprintImportedTaskInput["kind"];
type JiraStatusSelection =
  | { mode: "all" }
  | { mode: "status"; name: string }
  | { mode: "category"; value: JiraStatusFilter };
type JiraStatusLoadState = "idle" | "loading" | "loaded" | "fallback";

const STATUS_VALUES: ReadonlyArray<JiraStatusFilter> = ["open", "in_progress", "done", "all"];

const DEFAULT_CATEGORY_STATUS_SELECTION: JiraStatusSelection = { mode: "category", value: "open" };
const ALL_STATUS_SELECTION: JiraStatusSelection = { mode: "all" };

export const SprintJiraImportModal = ({
  projectId,
  onClose,
  onImport,
  onImportSpecialTasks,
}: SprintJiraImportModalProps) => {
  const { formatNumber, locale, translate, translatePlural } = useDashboardI18n();
  const jiraProvider = getIssueImportProviderMetadata("jira", undefined, locale);
  const statusOptions = useMemo(() => [
    { value: "open", label: translate(sprintsMessages, "open") },
    { value: "in_progress", label: translate(sprintsMessages, "inWork") },
    { value: "done", label: translate(sprintsMessages, "done") },
    { value: "all", label: translate(sprintsMessages, "allStatuses") },
  ] satisfies Array<{ value: JiraStatusFilter; label: string }>, [translate]);
  const sortFieldOptions = useMemo(() => [
    { value: "updated", label: translate(sprintsMessages, "updated") },
    { value: "created", label: translate(sprintsMessages, "created") },
    { value: "priority", label: translate(sprintsMessages, "priority") },
    { value: "status", label: translate(sprintsMessages, "status") },
    { value: "assignee", label: translate(sprintsMessages, "assignee") },
    { value: "reporter", label: translate(sprintsMessages, "reporter") },
  ] satisfies Array<{ value: JiraSortField; label: string }>, [translate]);
  const sortDirectionOptions = useMemo(() => [
    { value: "desc", label: translate(sprintsMessages, "newestFirst") },
    { value: "asc", label: translate(sprintsMessages, "oldestFirst") },
  ] satisfies Array<{ value: JiraSortDirection; label: string }>, [translate]);
  const [projectKey, setProjectKey] = useState("");
  const [issueKey, setIssueKey] = useState("");
  const [search, setSearch] = useState("");
  const [statusSelection, setStatusSelection] = useState<JiraStatusSelection>(DEFAULT_CATEGORY_STATUS_SELECTION);
  const [jiraStatuses, setJiraStatuses] = useState<JiraProjectStatus[]>([]);
  const [statusLoadState, setStatusLoadState] = useState<JiraStatusLoadState>("idle");
  const [statusFallbackReason, setStatusFallbackReason] = useState<string | null>(null);
  const [jiraDefaultsLoaded, setJiraDefaultsLoaded] = useState(false);
  const [assigneeText, setAssigneeText] = useState("");
  const [reporterText, setReporterText] = useState("");
  const [issueType, setIssueType] = useState("");
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [updatedAfter, setUpdatedAfter] = useState("");
  const [updatedBefore, setUpdatedBefore] = useState("");
  const [sortField, setSortField] = useState<JiraSortField>("updated");
  const [sortDirection, setSortDirection] = useState<JiraSortDirection>("desc");
  const [limit, setLimit] = useState(40);
  const [jql, setJql] = useState("");
  const [hideInWork, setHideInWork] = useState(true);
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const [fetchedResults, setFetchedResults] = useState<JiraIssueSearchResult[]>([]);
  const [results, setResults] = useState<JiraIssueSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [importModes, setImportModes] = useState<Record<string, ImportedTaskMode>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusSelectionRef = useRef<JiraStatusSelection>(DEFAULT_CATEGORY_STATUS_SELECTION);
  const initialSearchStartedRef = useRef(false);
  const hideInWorkRef = useRef(true);

  const selectedIssues = useMemo(() => (
    results.filter((issue) => selectedKeys.has(issue.key))
  ), [results, selectedKeys]);

  const getIssueImportMode = (issue: JiraIssueSearchResult): ImportedTaskMode => (
    importModes[issue.key] ?? "linked"
  );

  const selectedLinkedIssues = useMemo(() => (
    selectedIssues.filter((issue) => getIssueImportMode(issue) === "linked")
  ), [getIssueImportMode, selectedIssues]);

  const selectedSpecialTaskPayloads = useMemo(() => (
    selectedIssues.flatMap((issue) => {
      const mode = getIssueImportMode(issue);
      if (mode === "linked") {
        return [];
      }
      return [buildImportedTaskPayload(issue, mode, projectKey)];
    })
  ), [getIssueImportMode, projectKey, selectedIssues]);

  const selectedSpecialTaskCount = selectedSpecialTaskPayloads.length;
  const selectedLinkedIssueCount = selectedLinkedIssues.length;
  const selectedConversationEnabled = selectedIssues.length > 0
    && selectedIssues.every((issue) => !conversationDisabledKeys.has(issue.key));
  const selectedCountLabel = getSelectedIssueCountLabel(
    selectedIssues.length,
    selectedLinkedIssueCount,
    selectedSpecialTaskCount,
    locale,
  );
  const visibleSelectedCount = results.filter((issue) => selectedKeys.has(issue.key)).length;
  const emptyStateCopy = getIssueImportEmptyStateCopy("jira", hasSearched, locale);
  const normalizedProjectKey = useMemo(() => projectKey.trim().toUpperCase(), [projectKey]);
  const jiraStatusNames = useMemo(() => getUniqueJiraStatusNames(jiraStatuses), [jiraStatuses]);
  const useCategoryStatusFallback = statusLoadState === "fallback";
  const statusSelectionValue = getStatusSelectionFilterValue(statusSelection);
  const statusSelectionLabel = getStatusSelectionLabel(statusSelection, statusOptions, translate(sprintsMessages, "allStatuses"));
  const defaultStatusSelectionValue = useCategoryStatusFallback
    ? getStatusSelectionFilterValue(DEFAULT_CATEGORY_STATUS_SELECTION)
    : getStatusSelectionFilterValue(ALL_STATUS_SELECTION);
  const compactState = buildIssueImportCompactState({
    filters: [
      {
        id: "hideInWork",
        label: translate(sprintsMessages, "visibility"),
        value: hideInWork,
        defaultValue: false,
        valueLabel: hideInWork ? translate(sprintsMessages, "hideInWork") : null,
        priority: 1,
      },
      {
        id: "status",
        label: translate(sprintsMessages, "status"),
        value: statusSelectionValue,
        defaultValue: defaultStatusSelectionValue,
        valueLabel: statusSelectionLabel,
        defaultLabel: useCategoryStatusFallback ? translate(sprintsMessages, "open") : translate(sprintsMessages, "allStatuses"),
        alwaysShow: true,
        priority: 0,
      },
      { id: "project", label: translate(sprintsMessages, "project"), value: projectKey, priority: 2 },
      { id: "issue", label: translate(sprintsMessages, "issue"), value: issueKey, priority: 3 },
      { id: "search", label: translate(sprintsMessages, "text"), value: search, priority: 4 },
      { id: "assignee", label: translate(sprintsMessages, "assignee"), value: assigneeText, priority: 5 },
      { id: "reporter", label: translate(sprintsMessages, "reporter"), value: reporterText, priority: 6 },
      { id: "type", label: translate(sprintsMessages, "type"), value: issueType, priority: 7 },
      { id: "priority", label: translate(sprintsMessages, "priority"), value: priority, priority: 8 },
      { id: "labels", label: translate(sprintsMessages, "labels"), value: labels, priority: 9 },
      { id: "updatedAfter", label: translate(sprintsMessages, "updatedAfter"), value: updatedAfter, priority: 10 },
      { id: "updatedBefore", label: translate(sprintsMessages, "updatedBefore"), value: updatedBefore, priority: 11 },
      { id: "jql", label: "JQL", value: jql, priority: 12 },
    ],
    selectedCount: selectedIssues.length,
    visibleCount: results.length,
    totalCount: results.length,
    sortField,
    sortDirection,
    sortFieldOptions,
    sortDirectionOptions,
  }, locale);
  const guidedSearchSummary = getGuidedSearchSummary(statusSelection, compactState.sortLabel, sortField, sortDirection, locale, statusOptions);

  const updateStatusSelection = (selection: JiraStatusSelection): void => {
    statusSelectionRef.current = selection;
    setStatusSelection(selection);
  };

  const runSearch = async (
    overrides: Partial<{
      projectKey: string;
      issueKey: string;
      search: string;
      statusSelection: JiraStatusSelection;
      assigneeText: string;
      reporterText: string;
      issueType: string;
      priority: string;
      labels: string[];
      updatedAfter: string;
      updatedBefore: string;
      sortField: JiraSortField;
      sortDirection: JiraSortDirection;
      limit: number;
      jql: string;
    }> = {},
  ): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const searchStatusSelection = overrides.statusSelection ?? statusSelectionRef.current;
      const data = await searchJiraIssues(
        projectId,
        {
          projectKey: normalizeOptionalText(overrides.projectKey ?? projectKey).toUpperCase(),
          issueKey: normalizeOptionalText(overrides.issueKey ?? issueKey).toUpperCase(),
          search: normalizeOptionalText(overrides.search ?? search),
          ...getJiraStatusSearchInput(searchStatusSelection),
          assigneeText: normalizeOptionalText(overrides.assigneeText ?? assigneeText),
          reporterText: normalizeOptionalText(overrides.reporterText ?? reporterText),
          issueType: normalizeOptionalText(overrides.issueType ?? issueType),
          priority: normalizeOptionalText(overrides.priority ?? priority),
          labels: overrides.labels ?? labels,
          updatedAfter: normalizeOptionalDate(overrides.updatedAfter ?? updatedAfter),
          updatedBefore: normalizeOptionalDate(overrides.updatedBefore ?? updatedBefore),
          sortField: overrides.sortField ?? sortField,
          sortDirection: overrides.sortDirection ?? sortDirection,
          limit: overrides.limit ?? limit,
          jql: normalizeOptionalText(overrides.jql ?? jql),
        },
        controller.signal,
      );
      const visibleData = filterVisibleJiraIssues(data, hideInWorkRef.current);
      setFetchedResults(data);
      setResults(visibleData);
      pruneIssueStateToVisibleResults(visibleData);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const copy = getIssueImportErrorCopy(err, translate(sprintsMessages, "jiraSearchFailed"), locale);
      setError(copy.message);
      setFetchedResults([]);
      setResults([]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    initialSearchStartedRef.current = false;
    setJiraDefaultsLoaded(false);
    setJiraStatuses([]);
    setStatusLoadState("idle");
    setStatusFallbackReason(null);
    updateStatusSelection(DEFAULT_CATEGORY_STATUS_SELECTION);
    const loadDefaults = async (): Promise<void> => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        const defaultProject = effective.settings.jira.defaultProject.trim().toUpperCase();
        if (cancelled) {
          return;
        }
        setProjectKey(defaultProject);
        setJiraDefaultsLoaded(true);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const copy = getIssueImportErrorCopy(err, translate(sprintsMessages, "jiraDefaultsFailed"), locale);
        setError(copy.message);
        setHasSearched(true);
      }
    };
    void loadDefaults();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      statusAbortRef.current?.abort();
    };
  }, [projectId]);

  useEffect(() => {
    if (!jiraDefaultsLoaded) {
      return;
    }

    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    const projectKeyForStatuses = normalizedProjectKey;
    const shouldRunInitialSearch = !initialSearchStartedRef.current;
    setJiraStatuses([]);

    const finishInitialSearch = (selection: JiraStatusSelection): void => {
      if (!shouldRunInitialSearch || controller.signal.aborted) {
        return;
      }
      initialSearchStartedRef.current = true;
      void runSearch({
        projectKey: projectKeyForStatuses,
        statusSelection: selection,
      });
    };

    if (!projectKeyForStatuses) {
      const fallbackReason = translate(sprintsMessages, "jiraProjectKeyFallback");
      setStatusLoadState("fallback");
      setStatusFallbackReason(fallbackReason);
      updateStatusSelection(DEFAULT_CATEGORY_STATUS_SELECTION);
      finishInitialSearch(DEFAULT_CATEGORY_STATUS_SELECTION);
      return () => {
        controller.abort();
      };
    }

    setStatusLoadState("loading");
    setStatusFallbackReason(null);
    updateStatusSelection(ALL_STATUS_SELECTION);

    const loadStatuses = async (): Promise<void> => {
      try {
        const statuses = await fetchJiraProjectStatuses(projectId, projectKeyForStatuses, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        const statusNames = getUniqueJiraStatusNames(statuses);
        if (statusNames.length === 0) {
          const fallbackReason = translate(sprintsMessages, "jiraNoStatusesFallback");
          setJiraStatuses([]);
          setStatusLoadState("fallback");
          setStatusFallbackReason(fallbackReason);
          updateStatusSelection(DEFAULT_CATEGORY_STATUS_SELECTION);
          finishInitialSearch(DEFAULT_CATEGORY_STATUS_SELECTION);
          return;
        }
        setJiraStatuses(statuses);
        setStatusLoadState("loaded");
        setStatusFallbackReason(null);
        setStatusSelection((current) => {
          const nextSelection = current.mode === "status" && statusNames.includes(current.name)
            ? current
            : ALL_STATUS_SELECTION;
          statusSelectionRef.current = nextSelection;
          return nextSelection;
        });
        finishInitialSearch(ALL_STATUS_SELECTION);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (controller.signal.aborted) {
          return;
        }
        const copy = getIssueImportErrorCopy(err, translate(sprintsMessages, "jiraStatusesFailed"), locale);
        setJiraStatuses([]);
        setStatusLoadState("fallback");
        setStatusFallbackReason(copy.message);
        updateStatusSelection(DEFAULT_CATEGORY_STATUS_SELECTION);
        finishInitialSearch(DEFAULT_CATEGORY_STATUS_SELECTION);
      } finally {
        if (statusAbortRef.current === controller) {
          statusAbortRef.current = null;
        }
      }
    };

    void loadStatuses();
    return () => {
      controller.abort();
    };
  }, [jiraDefaultsLoaded, normalizedProjectKey, projectId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const toggleIssue = (issue: JiraIssueSearchResult): void => {
    const selected = selectedKeys.has(issue.key);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (selected) {
        next.delete(issue.key);
      } else {
        next.add(issue.key);
      }
      return next;
    });
    if (selected) {
      setConversationDisabledKeys((current) => {
        const next = new Set(current);
        next.delete(issue.key);
        return next;
      });
      setImportModes((currentModes) => {
        const nextModes = { ...currentModes };
        delete nextModes[issue.key];
        return nextModes;
      });
      return;
    }

  };

  const toggleConversation = (issue: JiraIssueSearchResult): void => {
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      if (next.has(issue.key)) {
        next.delete(issue.key);
      } else {
        next.add(issue.key);
      }
      return next;
    });
  };

  const selectAllVisible = (): void => {
    setSelectedKeys(new Set(results.map((issue) => issue.key)));
    if (onImportSpecialTasks) {
      setImportModes((current) => {
        const next = { ...current };
        for (const issue of results) {
          next[issue.key] = getIssueImportMode(issue);
        }
        return next;
      });
    } else {
      setImportModes({});
    }
  };

  const clearSelection = (): void => {
    setSelectedKeys(new Set());
    setConversationDisabledKeys(new Set());
    setImportModes({});
  };

  const pruneIssueStateToVisibleResults = (visibleIssues: ReadonlyArray<JiraIssueSearchResult>): void => {
    const visibleKeys = new Set(visibleIssues.map((issue) => issue.key));
    setSelectedKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
    setConversationDisabledKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
    setImportModes((current) => {
      const next: Record<string, ImportedTaskMode> = {};
      for (const [key, mode] of Object.entries(current)) {
        if (visibleKeys.has(key)) {
          next[key] = mode;
        }
      }
      return next;
    });
  };

  const handleHideInWorkChange = (enabled: boolean): void => {
    hideInWorkRef.current = enabled;
    setHideInWork(enabled);
    const visibleData = filterVisibleJiraIssues(fetchedResults, enabled);
    setResults(visibleData);
    pruneIssueStateToVisibleResults(visibleData);
  };

  const setImportModeForSelected = (mode: ImportedTaskMode): void => {
    if (selectedKeys.size === 0) {
      return;
    }
    setImportModes((currentModes) => {
      const next = { ...currentModes };
      for (const key of selectedKeys) {
        if (mode === "linked") {
          delete next[key];
        } else {
          next[key] = mode;
        }
      }
      return next;
    });
  };

  const setConversationForAllSelected = (enabled: boolean): void => {
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      for (const key of selectedKeys) {
        if (enabled) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  };

  const handleImport = async (): Promise<void> => {
    if (selectedIssues.length === 0) {
      return;
    }

    const issuesToLink = onImportSpecialTasks
      ? selectedIssues.filter((issue) => getIssueImportMode(issue) === "linked")
      : selectedIssues;
    const issuesToImportAsTasks = onImportSpecialTasks
      ? selectedIssues.filter((issue) => getIssueImportMode(issue) !== "linked")
      : [];

    setImporting(true);
    setError(null);
    try {
      if (issuesToImportAsTasks.length > 0 && onImportSpecialTasks) {
        onImportSpecialTasks(issuesToImportAsTasks.map((issue) => (
          buildImportedTaskPayload(issue, getIssueImportMode(issue) as SprintImportedTaskInput["kind"], projectKey)
        )));
      }

      if (issuesToLink.length > 0) {
        const inputs = issuesToLink.map((issue) => toLinkedIssueInput(issue, projectKey, !conversationDisabledKeys.has(issue.key)));
        const contexts = await fetchProjectIssuePromptContexts(projectId, inputs);
        onImport(contexts);
      }

      onClose();
    } catch (err) {
      const copy = getIssueImportErrorCopy(err, translate(sprintsMessages, "jiraImportFailed"), locale);
      setError(copy.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <IssueImportShell
      provider={jiraProvider}
      title={translate(sprintsMessages, "importBacklogScope")}
      description={translate(sprintsMessages, "jiraImportDescription")}
      onClose={onClose}
      closeLabel={translate(sprintsMessages, "closeJiraImport")}
      summaryRail={(
        <IssueImportSummaryRail
          provider={jiraProvider}
          title={translate(sprintsMessages, "selectJiraScope")}
          description={translate(sprintsMessages, "jiraImportDescription")}
          items={[
            { label: translate(sprintsMessages, "project"), value: projectKey || translate(sprintsMessages, "allProjects") },
            { label: translate(sprintsMessages, "sort"), value: compactState.sortLabel },
            { label: translate(sprintsMessages, "visible"), value: translate(sprintsMessages, "results", { count: formatNumber(results.length) }) },
            { label: translate(sprintsMessages, "linked"), value: formatNumber(selectedLinkedIssueCount), active: selectedLinkedIssueCount > 0 },
            { label: translate(sprintsMessages, "special"), value: formatNumber(selectedSpecialTaskCount), active: selectedSpecialTaskCount > 0 },
          ]}
          status={guidedSearchSummary}
        />
      )}
      filters={(
        <div className="grid gap-5">
          <IssueImportFilterSection
            title={translate(sprintsMessages, "guidedJiraSearch")}
            description={guidedSearchSummary}
            action={(
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={loading}
                className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-[1rem] bg-[#0052CC] px-5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-950 dark:hover:bg-[#3b85e0]"
                aria-label={translate(sprintsMessages, "search")}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {translate(sprintsMessages, "search")}
              </button>
            )}
          >
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <IssueImportField label={translate(sprintsMessages, "projectKey")} hint={translate(sprintsMessages, "projectKeyHint")}>
                <IssueImportTextInput
                  provider={jiraProvider}
                  value={projectKey}
                  onInput={(event) => setProjectKey((event.target as HTMLInputElement).value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder="OPS"
                  className="font-semibold uppercase tracking-[0.08em]"
                  aria-label={translate(sprintsMessages, "jiraProjectKey")}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "exactIssueKey")} hint={translate(sprintsMessages, "exactIssueKeyHint")}>
                <IssueImportTextInput
                  provider={jiraProvider}
                  value={issueKey}
                  onInput={(event) => setIssueKey((event.target as HTMLInputElement).value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder="OPS-42"
                  className="font-semibold uppercase tracking-[0.08em]"
                  aria-label={translate(sprintsMessages, "jiraExactIssueKey")}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "searchText")} hint={translate(sprintsMessages, "jiraSearchTextHint")}>
                <IssueImportTextInput
                  provider={jiraProvider}
                  value={search}
                  onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder={translate(sprintsMessages, "jiraSearchPlaceholder")}
                  aria-label={translate(sprintsMessages, "jiraSearchText")}
                />
              </IssueImportField>

              <IssueImportField
                label={translate(sprintsMessages, "status")}
                hint={
                  useCategoryStatusFallback
                    ? statusFallbackReason ?? translate(sprintsMessages, "categoryFallbackAvailable")
                    : statusLoadState === "loading"
                      ? translate(sprintsMessages, "loadingWorkflowLabels")
                      : translate(sprintsMessages, "usesWorkflowLabels")
                }
              >
                <IssueImportSelect
                  provider={jiraProvider}
                  aria-label={translate(sprintsMessages, "jiraStatus")}
                  value={getStatusSelectValue(statusSelection, jiraStatusNames, useCategoryStatusFallback)}
                  onChange={(value) => {
                    updateStatusSelection(parseStatusSelectValue(
                      value,
                      jiraStatusNames,
                      useCategoryStatusFallback,
                    ));
                  }}
                  options={useCategoryStatusFallback
                    ? statusOptions.map((option) => ({ value: `category:${option.value}`, label: option.label }))
                    : [
                        { value: "all", label: "All statuses" },
                        ...(statusLoadState === "loading" && jiraStatusNames.length === 0
                          ? [{ value: "loading", label: "Loading Jira statuses...", disabled: true }]
                          : []),
                        ...jiraStatusNames.map((statusName) => ({
                          value: `jira-status:${encodeURIComponent(statusName)}`,
                          label: statusName,
                        })),
                      ]}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "sortField")}>
                <IssueImportSelect
                  provider={jiraProvider}
                  aria-label={translate(sprintsMessages, "sortField")}
                  value={sortField}
                  onChange={(value) => setSortField(value as JiraSortField)}
                  options={sortFieldOptions.map((option) => ({ value: option.value, label: option.label }))}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "sortDirection")}>
                <IssueImportSelect
                  provider={jiraProvider}
                  aria-label={translate(sprintsMessages, "sortDirection")}
                  value={sortDirection}
                  onChange={(value) => setSortDirection(value as JiraSortDirection)}
                  options={sortDirectionOptions.map((option) => ({ value: option.value, label: option.label }))}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "limit")} hint={translate(sprintsMessages, "jiraLimitHint")}>
                <IssueImportNumberInput
                  provider={jiraProvider}
                  min={1}
                  max={100}
                  value={limit}
                  onInput={(event) => {
                    const nextValue = Number((event.target as HTMLInputElement).value);
                    setLimit(Number.isFinite(nextValue) ? Math.max(1, Math.min(100, Math.trunc(nextValue))) : 40);
                  }}
                  aria-label={translate(sprintsMessages, "jiraResultLimit")}
                />
              </IssueImportField>

              <IssueImportField
                label={translate(sprintsMessages, "visibility")}
                hint={translate(sprintsMessages, "visibilityHint")}
              >
                <label className="inline-flex min-h-11 items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white">
                  <input
                    type="checkbox"
                    checked={hideInWork}
                    onChange={(event) => handleHideInWorkChange((event.target as HTMLInputElement).checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0052CC] focus:ring-[#0052CC] dark:border-white/[0.18] dark:bg-transparent"
                  />
                  {translate(sprintsMessages, "hideInWork")}
                </label>
              </IssueImportField>
            </div>
          </IssueImportFilterSection>
        </div>
      )}
      advancedFilters={(
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <IssueImportFilterSection
              title={translate(sprintsMessages, "people")}
              description={translate(sprintsMessages, "jiraPeopleDescription")}
              compact
            >
              <div className="grid gap-4 md:grid-cols-2">
                <IssueImportField label={translate(sprintsMessages, "jiraAssignee")} hint={translate(sprintsMessages, "jiraAssigneeHint")}>
                  <IssueImportTextInput
                    provider={jiraProvider}
                    aria-label={translate(sprintsMessages, "jiraAssignee")}
                    value={assigneeText}
                    onInput={(event) => setAssigneeText((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="me"
                  />
                </IssueImportField>

                <IssueImportField label={translate(sprintsMessages, "jiraReporter")} hint={translate(sprintsMessages, "jiraReporterHint")}>
                  <IssueImportTextInput
                    provider={jiraProvider}
                    aria-label={translate(sprintsMessages, "jiraReporter")}
                    value={reporterText}
                    onInput={(event) => setReporterText((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="currentUser()"
                  />
                </IssueImportField>
              </div>
            </IssueImportFilterSection>

            <IssueImportFilterSection
              title={translate(sprintsMessages, "classification")}
              description={translate(sprintsMessages, "classificationDescription")}
              compact
            >
              <div className="grid gap-4 md:grid-cols-2">
                <IssueImportField label={translate(sprintsMessages, "issueType")}>
                  <IssueImportTextInput
                    provider={jiraProvider}
                    value={issueType}
                    onInput={(event) => setIssueType((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="Bug, Story, Epic"
                    aria-label={translate(sprintsMessages, "jiraIssueType")}
                  />
                </IssueImportField>

                <IssueImportField label={translate(sprintsMessages, "priority")}>
                  <IssueImportTextInput
                    provider={jiraProvider}
                    value={priority}
                    onInput={(event) => setPriority((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="High, Critical, Medium"
                    aria-label={translate(sprintsMessages, "jiraPriority")}
                  />
                </IssueImportField>

                <IssueImportMultiSelectField
                  label={translate(sprintsMessages, "labels")}
                  hint={translate(sprintsMessages, "jiraLabelsHint")}
                  className="md:col-span-2"
                >
                  <MultiSelect
                    value={labels}
                    onChange={setLabels}
                    placeholder={translate(sprintsMessages, "jiraLabelsPlaceholder")}
                  />
                </IssueImportMultiSelectField>
              </div>
            </IssueImportFilterSection>
          </div>

          <IssueImportFilterSection
            title={translate(sprintsMessages, "updatedWindow")}
            description={translate(sprintsMessages, "jiraUpdatedWindowDescription")}
            compact
          >
            <div className="grid gap-4 md:grid-cols-2">
              <IssueImportField label={translate(sprintsMessages, "updatedAfter")}>
                <IssueImportDateInput
                  provider={jiraProvider}
                  value={updatedAfter}
                  onInput={(event) => setUpdatedAfter((event.target as HTMLInputElement).value)}
                  aria-label={translate(sprintsMessages, "updatedAfter")}
                />
              </IssueImportField>

              <IssueImportField label={translate(sprintsMessages, "updatedBefore")}>
                <IssueImportDateInput
                  provider={jiraProvider}
                  value={updatedBefore}
                  onInput={(event) => setUpdatedBefore((event.target as HTMLInputElement).value)}
                  aria-label={translate(sprintsMessages, "updatedBefore")}
                />
              </IssueImportField>
            </div>
          </IssueImportFilterSection>

          <IssueImportFilterSection
            title={translate(sprintsMessages, "advancedJqlOverride")}
            description={translate(sprintsMessages, "advancedJqlDescription")}
            compact
          >
            <IssueImportTextarea
              provider={jiraProvider}
              value={jql}
              onInput={(event) => setJql((event.target as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  void runSearch();
                }
              }}
              rows={4}
              placeholder="project = OPS AND labels in (security)"
              aria-label={translate(sprintsMessages, "jiraJqlOverride")}
            />
          </IssueImportFilterSection>
        </div>
      )}
      advancedFiltersExpanded={advancedFiltersExpanded}
      advancedFiltersLabel={translate(sprintsMessages, "advancedJiraFilters")}
      advancedFiltersId="jira-import-advanced-filters"
      activeFilterCountLabel={compactState.activeFilterCountLabel}
      onAdvancedFiltersToggle={() => setAdvancedFiltersExpanded((expanded) => !expanded)}
      resultStatus={(
        <div className="flex flex-col gap-3 rounded-[1.1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {translatePlural(sprintsMessages, "jiraResultSummaryPlural", results.length, {
                visible: formatNumber(results.length),
                linked: formatNumber(selectedLinkedIssueCount),
                special: formatNumber(selectedSpecialTaskCount),
              })}
            </div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              {translate(sprintsMessages, "sortValue", { value: compactState.sortLabel })}
            </div>
          </div>
          {compactState.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={translate(sprintsMessages, "activeJiraFilters")}>
              {compactState.chips.map((chip) => (
                <span
                  key={chip.id}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${
                    chip.active
                      ? "bg-[#0052CC]/10 text-[#0052CC] ring-[#0052CC]/20 dark:bg-[#4C9AFF]/12 dark:text-[#9ecbff] dark:ring-[#4C9AFF]/20"
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
                  <span className="font-bold text-slate-600 dark:text-slate-200">
                    {selectedCountLabel}
                  </span>{" "}
                  {translate(sprintsMessages, "selectionOfVisibleResults", { selected: formatNumber(visibleSelectedCount), visible: formatNumber(results.length) })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    disabled={results.length === 0 || loading}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                    aria-label={translate(sprintsMessages, "selectAllVisibleResults")}
                  >
                    {translate(sprintsMessages, "selectAllVisible")}
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedIssues.length === 0}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                    aria-label={translate(sprintsMessages, "clearSelection")}
                  >
                    {translate(sprintsMessages, "clearAll")}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label
                  className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedConversationEnabled}
                    disabled={selectedIssues.length === 0}
                    onChange={(event) => setConversationForAllSelected((event.target as HTMLInputElement).checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[#0052CC] focus:ring-[#0052CC] dark:border-white/[0.18] dark:bg-transparent"
                    aria-label={translate(sprintsMessages, "appendConversationAllSelectedJira")}
                  />
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                  {translate(sprintsMessages, "appendConversationAllSelectedText")}
                </label>
                {onImportSpecialTasks && (
                  <div
                    className="flex flex-wrap items-center gap-1 rounded-[1rem] border border-black/[0.06] bg-white p-1 dark:border-white/[0.08] dark:bg-white/[0.05]"
                    role="group"
                    aria-label={translate(sprintsMessages, "jiraImportMode")}
                  >
                    {([
                      ["linked", translate(sprintsMessages, "linked")],
                      ["security", translate(sprintsMessages, "securityTask")],
                      ["quality", translate(sprintsMessages, "qualityTask")],
                    ] as Array<[ImportedTaskMode, string]>).map(([mode, label]) => {
                      const selectedMode = selectedIssues.length > 0
                        && selectedIssues.every((issue) => getIssueImportMode(issue) === mode);
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setImportModeForSelected(mode)}
                          disabled={selectedIssues.length === 0}
                          aria-pressed={selectedMode}
                          className={`rounded-[0.8rem] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            selectedMode
                              ? "bg-[#0052CC] text-white dark:bg-[#4C9AFF] dark:text-slate-950"
                              : "text-slate-500 hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-[1rem] border border-black/[0.06] px-5 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                  >
                    {translate(sprintsMessages, "cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleImport(); }}
                    disabled={selectedIssues.length === 0 || importing}
                    className="rounded-[1rem] bg-[#0052CC] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,82,204,0.2)] transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-900 dark:hover:bg-[#3b85e0]"
                    aria-label={translate(sprintsMessages, selectedIssues.length === 0 ? "importIssuesDisabled" : "importIssues")}
                  >
                    {translate(sprintsMessages, importing ? "importing" : "importIssues")}
                  </button>
                </div>
              </div>
            </div>
      )}
    >
      {error && (
        <IssueImportErrorPanel error={getIssueImportErrorCopy(error, undefined, locale)} />
      )}

      {loading ? (
        <IssueImportLoadingSkeletonList />
      ) : hasSearched && results.length === 0 ? (
        <IssueImportEmptyState
          title={emptyStateCopy.title}
          description={emptyStateCopy.description}
          action={(
            <button
              type="button"
              onClick={() => void runSearch()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[1rem] bg-[#0052CC] px-4 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px hover:bg-[#0047b3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]/30 dark:bg-[#4C9AFF] dark:text-slate-950"
              aria-label={translate(sprintsMessages, "searchJiraAgain")}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {translate(sprintsMessages, "searchAgainTitle")}
            </button>
          )}
        />
      ) : (
        <div className="grid gap-3">
          {results.map((issue) => {
            const selected = selectedKeys.has(issue.key);
            const importMode = getIssueImportMode(issue);
            return (
              <IssueImportIssueCard
                key={issue.key}
                provider={jiraProvider}
                issueKey={issue.key}
                title={issue.title}
                url={issue.url}
                bodyPreview={issue.bodyPreview}
                selected={selected}
                includeConversation={!conversationDisabledKeys.has(issue.key)}
                metadataRows={buildIssueImportMetadataRows({
                  provider: "jira",
                  projectKey: issue.projectKey,
                  issueKey: issue.key,
                  state: issue.state,
                  issueType: issue.issueType,
                  priority: issue.priority,
                  issueAuthor: issue.issueAuthor,
                  issueReporter: issue.issueReporter,
                  issueMilestone: issue.issueMilestone,
                  issueCommentCount: issue.issueCommentCount,
                  createdAt: issue.createdAt,
                  updatedAt: issue.updatedAt,
                }, locale)}
                labels={truncateIssueImportLabels(issue.labels ?? [], 6, locale)}
                assignees={truncateIssueImportAssignees(issue.assignees ?? [], 4, locale)}
                selectionLabel={translate(sprintsMessages, selected ? "selected" : "clickToSelect")}
                modeLabel={importMode === "linked"
                  ? translate(sprintsMessages, "linkedIssue")
                  : translate(sprintsMessages, "taskMode", { mode: translate(sprintsMessages, importMode === "security" ? "security" : importMode === "quality" ? "quality" : importMode === "merge_conflict" ? "mergeConflict" : "failedCi") })}
                icon={<JiraIcon className="h-4 w-4" />}
                metadataLimit={5}
                onToggle={() => toggleIssue(issue)}
                onToggleConversation={() => {
                  if (selected) {
                    toggleConversation(issue);
                  }
                }}
              />
            );
          })}
        </div>
      )}
    </IssueImportShell>
  );
};

function normalizeOptionalText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalDate(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function getUniqueJiraStatusNames(statuses: ReadonlyArray<JiraProjectStatus>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const status of statuses) {
    const name = status.name.trim();
    const normalizedName = normalizeJiraStatusText(name);
    if (!name || seen.has(normalizedName)) {
      continue;
    }
    seen.add(normalizedName);
    names.push(name);
  }
  return names;
}

function getStatusSelectionFilterValue(selection: JiraStatusSelection): string {
  if (selection.mode === "category") {
    return `category:${selection.value}`;
  }
  if (selection.mode === "status") {
    return `status:${selection.name}`;
  }
  return "all";
}

function getStatusSelectionLabel(
  selection: JiraStatusSelection,
  statusOptions: ReadonlyArray<{ value: JiraStatusFilter; label: string }>,
  allStatusesLabel: string,
): string {
  if (selection.mode === "category") {
    return getOptionLabel(statusOptions, selection.value);
  }
  if (selection.mode === "status") {
    return selection.name;
  }
  return allStatusesLabel;
}

function getStatusSelectValue(
  selection: JiraStatusSelection,
  statusNames: ReadonlyArray<string>,
  useCategoryFallback: boolean,
): string {
  if (useCategoryFallback) {
    return selection.mode === "category"
      ? `category:${selection.value}`
      : getStatusSelectionFilterValue(DEFAULT_CATEGORY_STATUS_SELECTION);
  }
  if (selection.mode !== "status") {
    return "all";
  }
  return statusNames.includes(selection.name) ? `jira-status:${encodeURIComponent(selection.name)}` : "all";
}

function parseStatusSelectValue(
  value: string,
  statusNames: ReadonlyArray<string>,
  useCategoryFallback: boolean,
): JiraStatusSelection {
  if (useCategoryFallback) {
    const categoryValue = value.startsWith("category:") ? value.slice("category:".length) : value;
    if (isJiraStatusFilter(categoryValue)) {
      return { mode: "category", value: categoryValue };
    }
    return DEFAULT_CATEGORY_STATUS_SELECTION;
  }

  if (value.startsWith("jira-status:")) {
    const statusName = decodeStatusSelectName(value.slice("jira-status:".length));
    if (statusName) {
      return { mode: "status", name: statusName };
    }
  }
  return ALL_STATUS_SELECTION;
}

function decodeStatusSelectName(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function isJiraStatusFilter(value: string): value is JiraStatusFilter {
  return STATUS_VALUES.some((option) => option === value);
}

function getJiraStatusSearchInput(selection: JiraStatusSelection): {
  status?: JiraStatusFilter;
  statusNames?: string[];
} {
  if (selection.mode === "category") {
    return { status: selection.value };
  }
  if (selection.mode === "status") {
    return { statusNames: [selection.name] };
  }
  return {};
}

function getGuidedSearchSummary(
  selection: JiraStatusSelection,
  sortLabel: string,
  sortField: JiraSortField,
  sortDirection: JiraSortDirection,
  locale: DashboardLocale,
  statusOptions: ReadonlyArray<{ value: JiraStatusFilter; label: string }>,
): string {
  if (selection.mode === "category" && selection.value === "open" && sortField === "updated" && sortDirection === "desc") {
    return translateDashboardMessage(sprintsMessages, locale, "guidedDefault");
  }
  if (selection.mode === "status") {
    return translateDashboardMessage(sprintsMessages, locale, "guidedStatus", { status: selection.name, sort: sortLabel.toLocaleLowerCase(locale) });
  }
  if (selection.mode === "all") {
    return translateDashboardMessage(sprintsMessages, locale, "guidedAll", { sort: sortLabel.toLocaleLowerCase(locale) });
  }
  return translateDashboardMessage(sprintsMessages, locale, "guidedCategory", {
    status: getOptionLabel(statusOptions, selection.value).toLocaleLowerCase(locale),
    sort: sortLabel.toLocaleLowerCase(locale),
  });
}

function getOptionLabel<TValue extends string>(
  options: ReadonlyArray<{ value: TValue; label: string }>,
  value: TValue,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function filterVisibleJiraIssues(
  issues: ReadonlyArray<JiraIssueSearchResult>,
  hideInWork: boolean,
): JiraIssueSearchResult[] {
  if (!hideInWork) {
    return [...issues];
  }
  return issues.filter((issue) => !isInWorkJiraIssue(issue));
}

function isInWorkJiraIssue(issue: JiraIssueSearchResult): boolean {
  const statusLikeIssue = issue as JiraIssueSearchResult & {
    status?: string | null;
    statusText?: string | null;
    statusName?: string | null;
  };
  return [
    statusLikeIssue.state,
    statusLikeIssue.status,
    statusLikeIssue.statusText,
    statusLikeIssue.statusName,
  ].some((value) => normalizeJiraStatusText(value) === "in work");
}

function normalizeJiraStatusText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildImportedTaskPayload(
  issue: JiraIssueSearchResult,
  mode: SprintImportedTaskInput["kind"],
  projectKey: string,
): SprintImportedTaskInput {
  return {
    kind: mode,
    title: issue.title,
    sourceUrl: issue.url,
    provider: "jira",
    repository: issue.projectKey || projectKey,
    labels: issue.labels,
    priority: mapTaskPriority(issue, mode),
  };
}

function mapTaskPriority(
  issue: JiraIssueSearchResult,
  mode: SprintImportedTaskInput["kind"],
): SprintImportedTaskInput["priority"] {
  const priority = (issue.priority || "").trim().toLowerCase();
  if (priority.includes("critical") || priority.includes("blocker") || priority.includes("highest")) {
    return "critical";
  }
  if (priority.includes("high") || priority.includes("major")) {
    return mode === "security" ? "critical" : "high";
  }
  if (priority.includes("low") || priority.includes("minor") || priority.includes("trivial")) {
    return "low";
  }
  return mode === "security" ? "high" : "medium";
}

function toLinkedIssueInput(
  issue: JiraIssueSearchResult,
  fallbackProjectKey: string,
  includeConversation: boolean,
): SprintLinkedIssueInput {
  const matches = issue.key.match(/^(.+)-(\d+)$/);
  const issueNumber = matches ? Number.parseInt(matches[2] || "0", 10) : 0;
  const projectKey = issue.projectKey || (matches ? matches[1] : fallbackProjectKey);
  return {
    provider: "jira",
    hostDomain: extractHostDomain(issue.url),
    projectKey,
    repository: projectKey,
    issueNumber,
    issueKey: issue.key,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees,
    includeConversation,
  };
}

function extractHostDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
