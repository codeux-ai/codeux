import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Check,
  ExternalLink,
  Filter,
  Loader2,
  MessageSquare,
  Search,
  Tag,
  UserRound,
  X,
} from "lucide-preact";
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
import { getSafeUrl } from "../../lib/safe-url.js";

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

  const selectedLinkedIssues = useMemo(() => (
    selectedIssues.filter((issue) => (importModes[issue.key] ?? inferImportedTaskMode(issue, Boolean(onImportSpecialTasks))) === "linked")
  ), [importModes, onImportSpecialTasks, selectedIssues]);

  const selectedSpecialTaskPayloads = useMemo(() => (
    selectedIssues.flatMap((issue) => {
      const mode = importModes[issue.key] ?? inferImportedTaskMode(issue, Boolean(onImportSpecialTasks));
      if (mode === "linked") {
        return [];
      }
      return [buildImportedTaskPayload(issue, mode, projectKey)];
    })
  ), [importModes, onImportSpecialTasks, projectKey, selectedIssues]);

  const selectedSpecialTaskCount = selectedSpecialTaskPayloads.length;
  const selectedLinkedIssueCount = selectedLinkedIssues.length;
  const selectedConversationEnabled = selectedIssues.length > 0
    && selectedIssues.every((issue) => !conversationDisabledKeys.has(issue.key));

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
      setError(err instanceof Error ? err.message : String(err));
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
        setError(err instanceof Error ? err.message : "Failed to load Jira defaults.");
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

    if (onImportSpecialTasks) {
      setImportModes((currentModes) => ({
        ...currentModes,
        [issue.key]: inferImportedTaskMode(issue, true),
      }));
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
          next[issue.key] = inferImportedTaskMode(issue, true);
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
      ? selectedIssues.filter((issue) => (importModes[issue.key] ?? inferImportedTaskMode(issue, true)) === "linked")
      : selectedIssues;
    const issuesToImportAsTasks = onImportSpecialTasks
      ? selectedIssues.filter((issue) => (importModes[issue.key] ?? inferImportedTaskMode(issue, true)) !== "linked")
      : [];

    setImporting(true);
    setError(null);
    try {
      if (issuesToImportAsTasks.length > 0 && onImportSpecialTasks) {
        onImportSpecialTasks(issuesToImportAsTasks.map((issue) => (
          buildImportedTaskPayload(issue, inferImportedTaskMode(issue, true) as SprintImportedTaskInput["kind"], projectKey)
        )));
      }

      if (issuesToLink.length > 0) {
        const inputs = issuesToLink.map((issue) => toLinkedIssueInput(issue, projectKey, !conversationDisabledKeys.has(issue.key)));
        const contexts = await fetchProjectIssuePromptContexts(projectId, inputs);
        onImport(contexts);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-xl dark:bg-black/75">
      <div className="flex max-h-[92vh] w-full max-w-7xl overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_48px_120px_rgba(15,23,42,0.28)] dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_48px_120px_rgba(0,0,0,0.72)]">
        <aside className="relative hidden w-72 shrink-0 flex-col justify-between overflow-hidden bg-slate-950 p-7 text-white xl:flex">
          <span className="pointer-events-none absolute -left-5 -top-3 select-none font-display text-[7.4rem] font-black leading-none tracking-tighter text-white/[0.035]">
            JIRA
          </span>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[#4C9AFF]/35 to-transparent" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4C9AFF]/25 bg-[#4C9AFF]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9ecbff]">
              <Filter className="h-3.5 w-3.5" strokeWidth={2.2} />
              Backlog Browser
            </div>
            <h2 className="mt-6 font-display text-4xl font-black leading-[0.95] tracking-tight">
              Select Jira Scope.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/52">
              Search Jira with exact keys, guided filters, and bulk selection, then import linked issues or special task payloads.
            </p>
          </div>
          <div className="relative z-10 grid gap-3">
            {([
              ["Project", projectKey || "all projects"],
              ["Selected", String(selectedIssues.length)],
              ["Linked", String(selectedLinkedIssueCount)],
              ["Special", String(selectedSpecialTaskCount)],
            ] as Array<[string, string]>).map(([label, value]) => (
              <div key={label} className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/34">{label}</div>
                <div className="mt-1 truncate text-xs font-bold text-white">{value}</div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#0052CC] dark:text-[#4C9AFF]">
                Jira Issues
              </div>
              <h2 className="mt-2 font-display text-3xl font-black leading-none text-slate-900 dark:text-white">
                Import Backlog Scope
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 transition-colors hover:bg-black/[0.08] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]/40 dark:bg-white/[0.05] dark:hover:text-white"
              aria-label="Close Jira import"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-5 border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7">
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
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm font-black uppercase tracking-[0.08em] text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
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
                    />
                  </LabeledControl>

                  <LabeledControl label="Updated after">
                    <input
                      type="date"
                      value={updatedAfter}
                      onInput={(event) => setUpdatedAfter((event.target as HTMLInputElement).value)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </LabeledControl>

                  <LabeledControl label="Updated before">
                    <input
                      type="date"
                      value={updatedBefore}
                      onInput={(event) => setUpdatedBefore((event.target as HTMLInputElement).value)}
                      className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-white px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
                    />
                  </LabeledControl>

                  <LabeledControl label="Sort field">
                    <select
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
                    />
                    <p className="text-xs leading-relaxed text-slate-400">
                      JQL is optional. Leave it empty for guided search, or use it to override every other filter.
                    </p>
                  </div>
                </details>
              </section>
            </div>

            <div className="min-h-0 flex-1 p-5 sm:p-7">
              {error && (
                <div className="mb-4 rounded-[1.1rem] border border-status-red/20 bg-status-red/[0.08] px-4 py-3 text-sm font-semibold text-status-red">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-28 animate-pulse rounded-[1.25rem] bg-black/[0.04] dark:bg-white/[0.04]" />
                  ))}
                </div>
              ) : hasSearched && results.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-black/[0.1] p-10 text-center text-sm font-semibold text-slate-400 dark:border-white/[0.1]">
                  No Jira issues found for the current filters.
                </div>
              ) : (
                <div className="grid gap-3">
                  {results.map((issue) => {
                    const selected = selectedKeys.has(issue.key);
                    const safeUrl = getSafeUrl(issue.url);
                    const importMode = importModes[issue.key] ?? inferImportedTaskMode(issue, Boolean(onImportSpecialTasks));
                    const isSpecialTask = importMode !== "linked";
                    const updatedLabel = formatTimestamp(issue.updatedAt);
                    return (
                      <button
                        key={issue.key}
                        type="button"
                        onClick={() => toggleIssue(issue)}
                        aria-pressed={selected}
                        className={`group rounded-[1.35rem] border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]/20 ${
                          selected
                            ? "border-[#0052CC]/35 bg-[#0052CC]/[0.08] shadow-[0_14px_32px_rgba(0,82,204,0.08)] dark:border-[#4C9AFF]/35 dark:bg-[#4C9AFF]/[0.12]"
                            : "border-black/[0.06] bg-black/[0.02] hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white/82 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.055]"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.85rem] ${
                            selected
                              ? "bg-[#0052CC] text-white dark:bg-[#4C9AFF] dark:text-slate-900"
                              : "bg-slate-900/[0.06] text-slate-500 dark:bg-white/[0.06] dark:text-slate-300"
                          }`}>
                            {selected ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <JiraIcon className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                              <span className="font-mono text-[#0052CC] dark:text-[#4C9AFF]">{issue.key}</span>
                              {issue.projectKey && <span>{issue.projectKey}</span>}
                              {issue.issueType && <span>{issue.issueType}</span>}
                              {issue.priority && <span>{issue.priority}</span>}
                              {isSpecialTask && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-300">
                                  {importMode} task
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm font-black leading-snug text-slate-900 dark:text-white">
                              {issue.title}
                            </div>
                            {issue.bodyPreview && (
                              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                {issue.bodyPreview}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                {issue.state || "Open"}
                              </span>
                              {updatedLabel && (
                                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                  Updated {updatedLabel}
                                </span>
                              )}
                              {issue.issueReporter && (
                                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                  <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} />
                                  <span className="truncate">{issue.issueReporter}</span>
                                </span>
                              )}
                                {(issue.assignees || []).map((name: string) => (
                                  <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                    <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} />
                                    <span className="truncate">{name}</span>
                                  </span>
                                ))}
                              {(issue.labels || []).slice(0, 6).map((label: string) => (
                                <span key={label} className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                  <Tag className="h-3 w-3 shrink-0" strokeWidth={2} />
                                  <span className="truncate">{label}</span>
                                </span>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <label
                                className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={!conversationDisabledKeys.has(issue.key)}
                                  onChange={() => toggleConversation(issue)}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-[#0052CC] focus:ring-[#0052CC] dark:border-white/[0.18] dark:bg-transparent"
                                />
                                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                                Append Conversation
                              </label>
                              <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300">
                                {selected ? "Selected" : "Click to select"}
                              </span>
                            </div>
                          </div>
                          {safeUrl ? (
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                              aria-label={`Open ${issue.key}`}
                            >
                              <ExternalLink className="h-4 w-4" strokeWidth={2.1} />
                            </a>
                          ) : (
                            <span
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 dark:text-slate-600"
                              aria-hidden="true"
                            >
                              <ExternalLink className="h-4 w-4" strokeWidth={2.1} />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <footer className="border-t border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7">
            <div className="flex flex-col gap-4 rounded-[1.4rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-xs font-semibold text-slate-400" aria-live="polite">
                  {selectedIssues.length === 0
                    ? "No Jira issues selected."
                    : `${selectedIssues.length} selected issue${selectedIssues.length === 1 ? "" : "s"} will be imported. ${selectedLinkedIssueCount} linked, ${selectedSpecialTaskCount} special task${selectedSpecialTaskCount === 1 ? "" : "s"}.`}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    disabled={results.length === 0 || loading}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                  >
                    Select all visible
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedIssues.length === 0}
                    className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
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
                    onChange={(event) => setConversationForAllSelected((event.target as HTMLInputElement).checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[#0052CC] focus:ring-[#0052CC] dark:border-white/[0.18] dark:bg-transparent"
                  />
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                  Append conversation to all selected
                </label>
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
                    className="rounded-[1rem] bg-[#0052CC] px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,82,204,0.2)] transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-900 dark:hover:bg-[#3b85e0]"
                  >
                    {importing ? "Importing..." : "Import Issues"}
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
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

function inferImportedTaskMode(issue: JiraIssueSearchResult, allowSpecialTasks: boolean): ImportedTaskMode {
  if (!allowSpecialTasks) {
    return "linked";
  }

  const normalizedLabels = (issue.labels || []).map((label) => label.trim().toLowerCase());
  const normalizedType = (issue.issueType || "").trim().toLowerCase();
  const normalizedPriority = (issue.priority || "").trim().toLowerCase();
  const normalizedText = [issue.title, issue.bodyPreview]
    .join(" ")
    .trim()
    .toLowerCase();

  if (
    normalizedLabels.some((label: string) => ["security", "sec", "vulnerability", "vuln"].includes(label))
    || ["security", "vulnerability", "incident"].some((term) => normalizedType.includes(term))
    || ["security", "vulnerability", "cve", "secret", "secrets"].some((term) => normalizedText.includes(term))
  ) {
    return "security";
  }

  if (
    normalizedLabels.some((label: string) => ["quality", "bug", "regression", "defect", "test"].includes(label))
    || ["bug", "regression", "defect", "quality"].some((term) => normalizedType.includes(term))
    || ["bug", "regression", "defect", "quality"].some((term) => normalizedText.includes(term))
    || ["highest", "critical"].includes(normalizedPriority)
  ) {
    return "quality";
  }

  return "linked";
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

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}
