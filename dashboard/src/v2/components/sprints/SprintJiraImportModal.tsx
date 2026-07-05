import { h } from "preact";
import type { ComponentChildren } from "preact";
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
  const [results, setResults] = useState<JiraIssueSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [importModes, setImportModes] = useState<Record<string, ImportedTaskMode>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      setResults(data);
      setSelectedKeys((current) => new Set([...current].filter((key) => data.some((issue) => issue.key === key))));
      setConversationDisabledKeys((current) => new Set([...current].filter((key) => data.some((issue) => issue.key === key))));
      setImportModes((current) => {
        const visibleKeys = new Set(data.map((issue) => issue.key));
        const next: Record<string, ImportedTaskMode> = {};
        for (const [key, mode] of Object.entries(current)) {
          if (visibleKeys.has(key)) {
            next[key] = mode;
          }
        }
        return next;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const copy = getIssueImportErrorCopy(err, "Jira search failed. Check the filters and try again.");
      setError(`Jira search error: ${copy.message}`);
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
            { label: "Visible selected", value: `${visibleSelectedCount} / ${results.length}` },
            { label: "Linked", value: String(selectedLinkedIssueCount) },
            { label: "Special", value: String(selectedSpecialTaskCount) },
          ]}
        />
      )}
      filters={(
        <div className="grid gap-5">
              <section className="grid gap-4 rounded-[1.5rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <LabeledControl label="Project key" hint="Leave blank to search all Jira projects.">
                    <input
                      value={projectKey}
                      onInput={(event) => setProjectKey((event.target as HTMLInputElement).value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="OPS"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira project key"
                    />
                  </LabeledControl>

                  <LabeledControl label="Exact issue key" hint="Use a full issue key like OPS-42, or leave blank to search by text.">
                    <input
                      value={issueKey}
                      onInput={(event) => setIssueKey((event.target as HTMLInputElement).value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="OPS-42"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira exact issue key"
                    />
                  </LabeledControl>

                  <LabeledControl label="Free-text search" hint="Search summaries, descriptions, and issue keys.">
                    <input
                      value={search}
                      onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="Search title, description, or key"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira search text"
                    />
                  </LabeledControl>

                  <LabeledControl label="Status">
                    <select
                      aria-label="Jira status"
                      value={status}
                      onChange={(event) => setStatus((event.target as HTMLSelectElement).value as JiraStatusFilter)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </LabeledControl>

                  <LabeledControl label="Assignee / user text" hint="Supports Jira names, emails, account IDs, me, currentUser(), unassigned, and empty.">
                    <input
                      aria-label="Jira assignee"
                      value={assigneeText}
                      onInput={(event) => setAssigneeText((event.target as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="me"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </LabeledControl>

                  <LabeledControl label="Reporter / user text" hint="Supports Jira names, emails, account IDs, me, and currentUser().">
                    <input
                      aria-label="Jira reporter"
                      value={reporterText}
                      onInput={(event) => setReporterText((event.target as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="currentUser()"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </LabeledControl>

                  <LabeledControl label="Issue type">
                    <input
                      value={issueType}
                      onInput={(event) => setIssueType((event.target as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="Bug, Story, Epic"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira issue type"
                    />
                  </LabeledControl>

                  <LabeledControl label="Priority">
                    <input
                      value={priority}
                      onInput={(event) => setPriority((event.target as HTMLInputElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void runSearch();
                        }
                      }}
                      placeholder="High, Critical, Medium"
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira priority"
                    />
                  </LabeledControl>

                  <LabeledControl label="Updated after">
                    <input
                      type="date"
                      value={updatedAfter}
                      onInput={(event) => setUpdatedAfter((event.target as HTMLInputElement).value)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Updated after"
                    />
                  </LabeledControl>

                  <LabeledControl label="Updated before">
                    <input
                      type="date"
                      value={updatedBefore}
                      onInput={(event) => setUpdatedBefore((event.target as HTMLInputElement).value)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Updated before"
                    />
                  </LabeledControl>

                  <LabeledControl label="Sort field">
                    <select
                      aria-label="Sort field"
                      value={sortField}
                      onChange={(event) => setSortField((event.target as HTMLSelectElement).value as JiraSortField)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {SORT_FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </LabeledControl>

                  <LabeledControl label="Sort direction">
                    <select
                      aria-label="Sort direction"
                      value={sortDirection}
                      onChange={(event) => setSortDirection((event.target as HTMLSelectElement).value as JiraSortDirection)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
                    >
                      {SORT_DIRECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </LabeledControl>

                  <LabeledControl label="Limit" hint="Bounded to the Jira search endpoint limit.">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={limit}
                      onInput={(event) => {
                        const nextValue = Number((event.target as HTMLInputElement).value);
                        setLimit(Number.isFinite(nextValue) ? Math.max(1, Math.min(100, Math.trunc(nextValue))) : 40);
                      }}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira result limit"
                    />
                  </LabeledControl>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
                  <LabeledControl label="Labels">
                    <MultiSelect
                      value={labels}
                      onChange={setLabels}
                      placeholder="Optional Jira labels, press Enter to add"
                    />
                  </LabeledControl>

                  <div className="grid gap-3 xl:self-end">
                    <button
                      type="button"
                      onClick={() => void runSearch()}
                      disabled={loading}
                      className="inline-flex h-12 min-w-40 items-center justify-center gap-2 rounded-[1.1rem] bg-slate-900 px-5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
                      aria-label="Search"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Search
                    </button>
                  </div>
                </div>

                <details className="rounded-[1.2rem] border border-black/[0.06] bg-white/80 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <summary className="cursor-pointer list-none text-xs font-black uppercase tracking-[0.14em] text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]/30">
                    Advanced JQL override
                  </summary>
                  <div className="mt-3 grid gap-2">
                    <textarea
                      value={jql}
                      onInput={(event) => setJql((event.target as HTMLTextAreaElement).value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          void runSearch();
                        }
                      }}
                      rows={4}
                      placeholder="project = OPS AND labels in (security)"
                      className="w-full rounded-[1.1rem] border border-black/[0.07] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                      aria-label="Jira JQL override"
                    />
                    <p className="text-xs leading-relaxed text-slate-400">
                      JQL is optional. Leave it empty for guided search, or use it to override every other filter.
                    </p>
                  </div>
                </details>
              </section>
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
                modeLabel={importMode === "linked" ? null : `${importMode} task`}
                icon={<JiraIcon className="h-4 w-4" />}
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

function LabeledControl({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
}): h.JSX.Element {
  return (
    <label className="grid gap-2">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-slate-400">{hint}</span>}
    </label>
  );
}

function normalizeOptionalText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalDate(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
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
