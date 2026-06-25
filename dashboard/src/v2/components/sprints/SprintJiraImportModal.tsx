import { h } from "preact";
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
import type { JiraIssueSearchResult } from "../../lib/project-api.js";
import { fetchProjectIssuePromptContexts, searchJiraIssues } from "../../lib/project-api.js";
import { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";
import type { SprintLinkedIssueInput } from "../../types.js";
import { MultiSelect } from "../ui/MultiSelect.js";
import { getSafeUrl } from "../../lib/safe-url.js";

interface SprintJiraImportModalProps {
  projectId: string;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void;
}

type JiraStatusFilter = "open" | "in_progress" | "done" | "all";

const STATUS_OPTIONS: Array<{ value: JiraStatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

export const SprintJiraImportModal = ({ projectId, onClose, onImport }: SprintJiraImportModalProps) => {
  const [projectKey, setProjectKey] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JiraStatusFilter>("open");
  const [assigneeText, setAssigneeText] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [results, setResults] = useState<JiraIssueSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedIssues = useMemo(() => (
    results.filter((issue) => selectedKeys.has(issue.key))
  ), [results, selectedKeys]);

  const runSearch = async (overrides: Partial<{
    projectKey: string;
    search: string;
    status: JiraStatusFilter;
    assigneeText: string;
    labels: string[];
  }> = {}): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const data = await searchJiraIssues(projectId, {
        projectKey: overrides.projectKey ?? projectKey,
        search: overrides.search ?? search,
        status: overrides.status ?? status,
        assigneeText: overrides.assigneeText ?? assigneeText,
        labels: overrides.labels ?? labels,
        limit: 40,
      }, controller.signal);
      setResults(data);
      setSelectedKeys((current) => new Set([...current].filter((key) => data.some((issue) => issue.key === key))));
      setConversationDisabledKeys((current) => new Set([...current].filter((key) => data.some((issue) => issue.key === key))));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
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
    const loadDefaults = async (): Promise<void> => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        const defaultProject = effective.settings.jira.defaultProject.trim().toUpperCase();
        if (defaultProject) {
          setProjectKey(defaultProject);
        }
        await runSearch({ projectKey: defaultProject });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Jira defaults.");
        setHasSearched(true);
      }
    };
    void loadDefaults();
    return () => abortRef.current?.abort();
  }, [projectId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const toggleIssue = (issue: JiraIssueSearchResult): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(issue.key)) next.delete(issue.key);
      else next.add(issue.key);
      return next;
    });
  };

  const toggleConversation = (issue: JiraIssueSearchResult): void => {
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      if (next.has(issue.key)) next.delete(issue.key);
      else next.add(issue.key);
      return next;
    });
  };

  const handleImport = async (): Promise<void> => {
    if (selectedIssues.length === 0) return;

    const selectedInputs: SprintLinkedIssueInput[] = selectedIssues.map((issue) => {
      const matches = issue.key.match(/^(.+)-(\d+)$/);
      const issueNumber = matches ? parseInt(matches[2], 10) : 0;
      const issueProjectKey = issue.projectKey || (matches ? matches[1] : projectKey);
      return {
        provider: "jira",
        hostDomain: extractHostDomain(issue.url),
        projectKey: issueProjectKey,
        repository: issueProjectKey,
        issueNumber,
        issueKey: issue.key,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees,
        includeConversation: !conversationDisabledKeys.has(issue.key),
      };
    });

    setImporting(true);
    setError(null);
    try {
      const contexts = await fetchProjectIssuePromptContexts(projectId, selectedInputs);
      onImport(contexts);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-xl dark:bg-black/75">
      <div className="flex max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[2.25rem] border border-white/70 bg-white shadow-[0_48px_120px_rgba(15,23,42,0.28)] dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_48px_120px_rgba(0,0,0,0.72)]">
        <aside className="relative hidden w-72 shrink-0 flex-col justify-between overflow-hidden bg-slate-950 p-7 text-white lg:flex">
          <span className="pointer-events-none absolute -left-5 -top-3 select-none font-display text-[7.4rem] font-black leading-none tracking-tighter text-white/[0.035]">
            JIRA
          </span>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[#4C9AFF]/35 to-transparent" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4C9AFF]/25 bg-[#4C9AFF]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9ecbff]">
              <Filter className="h-3.5 w-3.5" strokeWidth={2.2} />
              Backlog Import
            </div>
            <h2 className="mt-6 font-display text-4xl font-black leading-[0.95] tracking-tight">
              Select Jira Scope.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/52">
              Bring Jira issues into the sprint composer with saved Jira credentials and guided filters.
            </p>
          </div>
          <div className="relative z-10 grid gap-3">
            {[
              ["Provider", "Jira"],
              ["Project", projectKey || "all projects"],
              ["Selected", String(selectedIssues.length)],
            ].map(([label, value]) => (
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 transition-colors hover:bg-black/[0.08] hover:text-slate-900 dark:bg-white/[0.05] dark:hover:text-white"
              aria-label="Close Jira import"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="grid gap-4 border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7 lg:grid-cols-[8rem_minmax(0,1fr)_10rem_minmax(10rem,13rem)_auto]">
            <input
              value={projectKey}
              onInput={(event) => setProjectKey((event.target as HTMLInputElement).value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runSearch();
              }}
              placeholder="PROJ"
              className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] px-4 text-sm font-black uppercase tracking-[0.08em] text-slate-700 outline-none transition-colors focus:border-[#0052CC] dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="Search title, description, or key"
                className="h-12 w-full rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] pl-11 pr-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
              />
            </div>
            <select
              aria-label="Jira status"
              value={status}
              onChange={(event) => setStatus((event.target as HTMLSelectElement).value as JiraStatusFilter)}
              onInput={(event) => setStatus((event.target as HTMLSelectElement).value as JiraStatusFilter)}
              className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-[#0052CC] dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              aria-label="Jira assignee"
              value={assigneeText}
              onInput={(event) => setAssigneeText((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runSearch();
              }}
              placeholder="Assignee name, email, or ID"
              className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] px-4 text-sm text-slate-700 outline-none transition-colors focus:border-[#0052CC] dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-slate-900 px-5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
            <div className="lg:col-span-5">
              <MultiSelect
                value={labels}
                onChange={setLabels}
                placeholder="Optional Jira labels, press Enter to add"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {error && (
              <div className="mb-4 rounded-[1.1rem] border border-status-red/20 bg-status-red/[0.08] px-4 py-3 text-sm font-semibold text-status-red">
                {error}
              </div>
            )}
            {loading ? (
              <div className="grid gap-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-[1.25rem] bg-black/[0.04] dark:bg-white/[0.04]" />
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
                  return (
                    <button
                      key={issue.key}
                      type="button"
                      onClick={() => toggleIssue(issue)}
                      className={`group rounded-[1.35rem] border p-4 text-left transition-all ${
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
                            {(issue.assignees || []).map((name) => (
                              <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} />
                                <span className="truncate">{name}</span>
                              </span>
                            ))}
                            {(issue.labels || []).slice(0, 6).map((label) => (
                              <span key={label} className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                                <Tag className="h-3 w-3 shrink-0" strokeWidth={2} />
                                <span className="truncate">{label}</span>
                              </span>
                            ))}
                          </div>
                          <label
                            className="mt-3 inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
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
                        </div>
                        <a
                          href={getSafeUrl(issue.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                          aria-label={`Open ${issue.key}`}
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={2.1} />
                        </a>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <footer className="flex flex-col gap-3 border-t border-black/[0.06] p-5 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="text-xs font-semibold text-slate-400">
              {selectedIssues.length} selected issue{selectedIssues.length === 1 ? "" : "s"} will be linked to the sprint.
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[1rem] border border-black/[0.06] px-5 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
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
          </footer>
        </div>
      </div>
    </div>
  );
};

const extractHostDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
