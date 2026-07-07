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

const STATUS_OPTIONS: Array<{ value: JiraStatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

const SORT_FIELD_OPTIONS: Array<{ value: JiraSortField; label: string }> = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "reporter", label: "Reporter" },
];

const SORT_DIRECTION_OPTIONS: Array<{ value: JiraSortDirection; label: string }> = [
  { value: "desc", label: "Newest first" },
  { value: "asc", label: "Oldest first" },
];

const JIRA_PROVIDER = getIssueImportProviderMetadata("jira");

export const SprintJiraImportModal = ({
  projectId,
  onClose,
  onImport,
  onImportSpecialTasks,
}: SprintJiraImportModalProps) => {
  const [projectKey, setProjectKey] = useState("");
  const [issueKey, setIssueKey] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JiraStatusFilter>("open");
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
  );
  const visibleSelectedCount = results.filter((issue) => selectedKeys.has(issue.key)).length;
  const emptyStateCopy = getIssueImportEmptyStateCopy("jira", hasSearched);
  const compactState = buildIssueImportCompactState({
    filters: [
      {
        id: "hideInWork",
        label: "Visibility",
        value: hideInWork,
        defaultValue: false,
        valueLabel: hideInWork ? "Hide in Work" : null,
        priority: 1,
      },
      {
        id: "status",
        label: "Status",
        value: status,
        defaultValue: "open",
        valueLabel: getOptionLabel(STATUS_OPTIONS, status),
        defaultLabel: "Open",
        alwaysShow: true,
        priority: 0,
      },
      { id: "project", label: "Project", value: projectKey, priority: 2 },
      { id: "issue", label: "Issue", value: issueKey, priority: 3 },
      { id: "search", label: "Text", value: search, priority: 4 },
      { id: "assignee", label: "Assignee", value: assigneeText, priority: 5 },
      { id: "reporter", label: "Reporter", value: reporterText, priority: 6 },
      { id: "type", label: "Type", value: issueType, priority: 7 },
      { id: "priority", label: "Priority", value: priority, priority: 8 },
      { id: "labels", label: "Labels", value: labels, priority: 9 },
      { id: "updatedAfter", label: "Updated after", value: updatedAfter, priority: 10 },
      { id: "updatedBefore", label: "Updated before", value: updatedBefore, priority: 11 },
      { id: "jql", label: "JQL", value: jql, priority: 12 },
    ],
    selectedCount: selectedIssues.length,
    visibleCount: results.length,
    totalCount: results.length,
    sortField,
    sortDirection,
    sortFieldOptions: SORT_FIELD_OPTIONS,
    sortDirectionOptions: SORT_DIRECTION_OPTIONS,
  });
  const guidedSearchSummary = status === "open" && sortField === "updated" && sortDirection === "desc"
    ? "Default: open Jira issues, recently updated first."
    : `Showing ${getOptionLabel(STATUS_OPTIONS, status).toLowerCase()} Jira issues sorted by ${compactState.sortLabel.toLowerCase()}.`;

  const runSearch = async (
    overrides: Partial<{
      projectKey: string;
      issueKey: string;
      search: string;
      status: JiraStatusFilter;
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
      const data = await searchJiraIssues(
        projectId,
        {
          projectKey: normalizeOptionalText(overrides.projectKey ?? projectKey).toUpperCase(),
          issueKey: normalizeOptionalText(overrides.issueKey ?? issueKey).toUpperCase(),
          search: normalizeOptionalText(overrides.search ?? search),
          status: overrides.status ?? status,
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
      const copy = getIssueImportErrorCopy(err, "Jira search failed. Check the filters and try again.");
      setError(`Jira search error: ${copy.message}`);
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
    const loadDefaults = async (): Promise<void> => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        const defaultProject = effective.settings.jira.defaultProject.trim().toUpperCase();
        if (cancelled) {
          return;
        }
        setProjectKey(defaultProject);
        await runSearch({ projectKey: defaultProject });
      } catch (err) {
        if (cancelled) {
          return;
        }
        const copy = getIssueImportErrorCopy(err, "Failed to load Jira defaults.");
        setError(`Jira configuration error: ${copy.message}`);
        setHasSearched(true);
      }
    };
    void loadDefaults();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [projectId]);

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
      const copy = getIssueImportErrorCopy(err, "Jira import failed. Try again after checking the selected issues.");
      setError(`Jira import error: ${copy.message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <IssueImportShell
      provider={JIRA_PROVIDER}
      title="Import Backlog Scope"
      description="Search Jira with exact keys, guided filters, and bulk selection, then import linked issues or special task payloads."
      onClose={onClose}
      closeLabel="Close Jira import"
      summaryRail={(
        <IssueImportSummaryRail
          provider={JIRA_PROVIDER}
          title="Select Jira Scope."
          description="Search Jira with exact keys, guided filters, and bulk selection, then import linked issues or special task payloads."
          items={[
            { label: "Project", value: projectKey || "all projects" },
            { label: "Sort", value: compactState.sortLabel },
            { label: "Visible", value: `${results.length} results` },
            { label: "Linked", value: String(selectedLinkedIssueCount), active: selectedLinkedIssueCount > 0 },
            { label: "Special", value: String(selectedSpecialTaskCount), active: selectedSpecialTaskCount > 0 },
          ]}
          status={guidedSearchSummary}
        />
      )}
      filters={(
        <div className="grid gap-5">
          <IssueImportFilterSection
            title="Guided Jira Search"
            description={guidedSearchSummary}
            action={(
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={loading}
                className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-[1rem] bg-[#0052CC] px-5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-950 dark:hover:bg-[#3b85e0]"
                aria-label="Search"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </button>
            )}
          >
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <IssueImportField label="Project key" hint="Leave blank to search all Jira projects.">
                <IssueImportTextInput
                  provider={JIRA_PROVIDER}
                  value={projectKey}
                  onInput={(event) => setProjectKey((event.target as HTMLInputElement).value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder="OPS"
                  className="font-semibold uppercase tracking-[0.08em]"
                  aria-label="Jira project key"
                />
              </IssueImportField>

              <IssueImportField label="Exact issue key" hint="Use a full issue key like OPS-42.">
                <IssueImportTextInput
                  provider={JIRA_PROVIDER}
                  value={issueKey}
                  onInput={(event) => setIssueKey((event.target as HTMLInputElement).value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder="OPS-42"
                  className="font-semibold uppercase tracking-[0.08em]"
                  aria-label="Jira exact issue key"
                />
              </IssueImportField>

              <IssueImportField label="Search text" hint="Search summaries, descriptions, and issue keys.">
                <IssueImportTextInput
                  provider={JIRA_PROVIDER}
                  value={search}
                  onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch();
                    }
                  }}
                  placeholder="Search title, description, or key"
                  aria-label="Jira search text"
                />
              </IssueImportField>

              <IssueImportField label="Status">
                <IssueImportSelect
                  provider={JIRA_PROVIDER}
                  aria-label="Jira status"
                  value={status}
                  onChange={(event) => setStatus((event.target as HTMLSelectElement).value as JiraStatusFilter)}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </IssueImportSelect>
              </IssueImportField>

              <IssueImportField label="Sort field">
                <IssueImportSelect
                  provider={JIRA_PROVIDER}
                  aria-label="Sort field"
                  value={sortField}
                  onChange={(event) => setSortField((event.target as HTMLSelectElement).value as JiraSortField)}
                >
                  {SORT_FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </IssueImportSelect>
              </IssueImportField>

              <IssueImportField label="Sort direction">
                <IssueImportSelect
                  provider={JIRA_PROVIDER}
                  aria-label="Sort direction"
                  value={sortDirection}
                  onChange={(event) => setSortDirection((event.target as HTMLSelectElement).value as JiraSortDirection)}
                >
                  {SORT_DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </IssueImportSelect>
              </IssueImportField>

              <IssueImportField label="Limit" hint="Bounded to the Jira search endpoint limit.">
                <IssueImportNumberInput
                  provider={JIRA_PROVIDER}
                  min={1}
                  max={100}
                  value={limit}
                  onInput={(event) => {
                    const nextValue = Number((event.target as HTMLInputElement).value);
                    setLimit(Number.isFinite(nextValue) ? Math.max(1, Math.min(100, Math.trunc(nextValue))) : 40);
                  }}
                  aria-label="Jira result limit"
                />
              </IssueImportField>

              <IssueImportField
                label="Visibility"
                hint="Client-side only. The Jira search still uses the selected status filter."
              >
                <label className="inline-flex min-h-11 items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white">
                  <input
                    type="checkbox"
                    checked={hideInWork}
                    onChange={(event) => handleHideInWorkChange((event.target as HTMLInputElement).checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0052CC] focus:ring-[#0052CC] dark:border-white/[0.18] dark:bg-transparent"
                  />
                  Hide in Work
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
              title="People"
              description="Narrow by Jira assignee or reporter text when the default open backlog is too broad."
              compact
            >
              <div className="grid gap-4 md:grid-cols-2">
                <IssueImportField label="Jira assignee" hint="Supports names, emails, account IDs, me, currentUser(), unassigned, and empty.">
                  <IssueImportTextInput
                    provider={JIRA_PROVIDER}
                    aria-label="Jira assignee"
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

                <IssueImportField label="Jira reporter" hint="Supports names, emails, account IDs, me, and currentUser().">
                  <IssueImportTextInput
                    provider={JIRA_PROVIDER}
                    aria-label="Jira reporter"
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
              title="Classification"
              description="Filter Jira taxonomy fields without changing the import mode."
              compact
            >
              <div className="grid gap-4 md:grid-cols-2">
                <IssueImportField label="Issue type">
                  <IssueImportTextInput
                    provider={JIRA_PROVIDER}
                    value={issueType}
                    onInput={(event) => setIssueType((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="Bug, Story, Epic"
                    aria-label="Jira issue type"
                  />
                </IssueImportField>

                <IssueImportField label="Priority">
                  <IssueImportTextInput
                    provider={JIRA_PROVIDER}
                    value={priority}
                    onInput={(event) => setPriority((event.target as HTMLInputElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch();
                      }
                    }}
                    placeholder="High, Critical, Medium"
                    aria-label="Jira priority"
                  />
                </IssueImportField>

                <IssueImportMultiSelectField
                  label="Labels"
                  hint="Labels narrow search only. They do not switch issues into special-task mode."
                  className="md:col-span-2"
                >
                  <MultiSelect
                    value={labels}
                    onChange={setLabels}
                    placeholder="Optional Jira labels, press Enter to add"
                  />
                </IssueImportMultiSelectField>
              </div>
            </IssueImportFilterSection>
          </div>

          <IssueImportFilterSection
            title="Updated Window"
            description="Use Jira updated dates when recent-first sorting still returns too much history."
            compact
          >
            <div className="grid gap-4 md:grid-cols-2">
              <IssueImportField label="Updated after">
                <IssueImportDateInput
                  provider={JIRA_PROVIDER}
                  value={updatedAfter}
                  onInput={(event) => setUpdatedAfter((event.target as HTMLInputElement).value)}
                  aria-label="Updated after"
                />
              </IssueImportField>

              <IssueImportField label="Updated before">
                <IssueImportDateInput
                  provider={JIRA_PROVIDER}
                  value={updatedBefore}
                  onInput={(event) => setUpdatedBefore((event.target as HTMLInputElement).value)}
                  aria-label="Updated before"
                />
              </IssueImportField>
            </div>
          </IssueImportFilterSection>

          <IssueImportFilterSection
            title="Advanced JQL Override"
            description="When present, JQL replaces the guided filters in the Jira search request."
            compact
          >
            <IssueImportTextarea
              provider={JIRA_PROVIDER}
              value={jql}
              onInput={(event) => setJql((event.target as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  void runSearch();
                }
              }}
              rows={4}
              placeholder="project = OPS AND labels in (security)"
              aria-label="Jira JQL override"
            />
          </IssueImportFilterSection>
        </div>
      )}
      advancedFiltersExpanded={advancedFiltersExpanded}
      advancedFiltersLabel="Advanced Jira filters"
      advancedFiltersId="jira-import-advanced-filters"
      activeFilterCountLabel={compactState.activeFilterCountLabel}
      onAdvancedFiltersToggle={() => setAdvancedFiltersExpanded((expanded) => !expanded)}
      resultStatus={(
        <div className="flex flex-col gap-3 rounded-[1.1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="font-black text-slate-700 dark:text-slate-200">{results.length}</span>{" "}
              visible {results.length === 1 ? "result" : "results"}.
              {" "}
              <span className="font-black text-slate-700 dark:text-slate-200">{selectedLinkedIssueCount}</span>{" "}
              linked,
              {" "}
              <span className="font-black text-slate-700 dark:text-slate-200">{selectedSpecialTaskCount}</span>{" "}
              special.
            </div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Sort: {compactState.sortLabel}
            </div>
          </div>
          {compactState.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Active Jira filters">
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
                  {visibleSelectedCount} of {results.length} visible results selected.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    disabled={results.length === 0 || loading}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                    aria-label="Select all visible results"
                  >
                    Select all visible
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedIssues.length === 0}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                    aria-label="Clear selection"
                  >
                    Clear all
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
                    aria-label="Append conversation to all selected Jira issues"
                  />
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                  Append conversation to all selected
                </label>
                {onImportSpecialTasks && (
                  <div
                    className="flex flex-wrap items-center gap-1 rounded-[1rem] border border-black/[0.06] bg-white p-1 dark:border-white/[0.08] dark:bg-white/[0.05]"
                    role="group"
                    aria-label="Jira import mode for selected issues"
                  >
                    {([
                      ["linked", "Linked"],
                      ["security", "Security task"],
                      ["quality", "Quality task"],
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
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleImport(); }}
                    disabled={selectedIssues.length === 0 || importing}
                    className="rounded-[1rem] bg-[#0052CC] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,82,204,0.2)] transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-900 dark:hover:bg-[#3b85e0]"
                    aria-label={selectedIssues.length === 0 ? "Import issues disabled until Jira issues are selected" : "Import issues"}
                  >
                    {importing ? "Importing..." : "Import Issues"}
                  </button>
                </div>
              </div>
            </div>
      )}
    >
      {error && (
        <IssueImportErrorPanel error={getIssueImportErrorCopy(error)} />
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
              aria-label="Search Jira issues again"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Search Again
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
                provider={JIRA_PROVIDER}
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
                })}
                labels={truncateIssueImportLabels(issue.labels ?? [], 6)}
                assignees={truncateIssueImportAssignees(issue.assignees ?? [], 4)}
                selectionLabel={selected ? "Selected" : "Click to select"}
                modeLabel={importMode === "linked" ? "Linked issue" : `${importMode} task`}
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
