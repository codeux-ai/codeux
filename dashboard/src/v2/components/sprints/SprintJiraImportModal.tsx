import { h } from "preact";
import { useEffect, useState, useRef } from "preact/hooks";
import { Check, ExternalLink, Loader2, Search, Tag, X } from "lucide-preact";
import { JiraIcon } from "../icons/JiraIcon.js";
import type { JiraIssueSearchResult } from "../../lib/project-api.js";
import { fetchProjectIssuePromptContexts, searchJiraIssues } from "../../lib/project-api.js";
import { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";
import type { SprintLinkedIssueInput } from "../../types.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import gsap from "gsap";

interface SprintJiraImportModalProps {
  projectId: string;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void;
}

export const SprintJiraImportModal = ({ projectId, onClose, onImport }: SprintJiraImportModalProps) => {
  const [jql, setJql] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [results, setResults] = useState<JiraIssueSearchResult[] | null>(null);

  // Set of issue keys
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    let ctx = gsap.context(() => {});
    if (prefersReducedMotion) {
      gsap.set(overlayRef.current, { opacity: 1 });
      gsap.set(panelRef.current, { opacity: 1, scale: 1, y: 0 });
    } else {
      ctx = gsap.context(() => {
        gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
        gsap.fromTo(
          panelRef.current,
          { opacity: 0, scale: 0.95, y: 20 },
          { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: "back.out(1.1)", clearProps: "all" }
        );
      });
    }
    return () => ctx.revert();
  }, [prefersReducedMotion]);

  useEffect(() => {
    const loadDefaultJql = async () => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        const defaultProject = effective.settings.jira.defaultProject.trim();
        if (defaultProject) {
          setJql((current) => current.trim() ? current : `project = ${defaultProject} ORDER BY updated DESC`);
        }
      } catch (err) {
        console.error("Failed to load Jira defaults", err);
      }
    };
    void loadDefaultJql();
  }, [projectId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const runSearch = async () => {
    if (!jql.trim()) {
      setError("Please enter a JQL query.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await searchJiraIssues(projectId, jql);
      setResults(data);
    } catch (err: any) {
      setError(err.message || "Failed to search Jira issues.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleIssue = (issue: JiraIssueSearchResult) => {
    const next = new Set(selectedKeys);
    if (next.has(issue.key)) {
      next.delete(issue.key);
    } else {
      next.add(issue.key);
    }
    setSelectedKeys(next);
  };

  const toggleConversation = (issue: JiraIssueSearchResult) => {
    const next = new Set(conversationDisabledKeys);
    if (next.has(issue.key)) {
      next.delete(issue.key);
    } else {
      next.add(issue.key);
    }
    setConversationDisabledKeys(next);
  };

  const handleImport = async () => {
    if (selectedKeys.size === 0) return;

    const selectedIssues: SprintLinkedIssueInput[] = (results || [])
      .filter((issue) => selectedKeys.has(issue.key))
      .map((issue) => {
        const matches = issue.key.match(/^([A-Z0-9]+)-(\d+)$/);
        const issueNumber = matches ? parseInt(matches[2], 10) : 0;
        const hostDomain = extractHostDomain(issue.url);
        return {
          provider: "jira",
          hostDomain,
          projectKey: issue.projectKey || (matches ? matches[1] : undefined),
          repository: issue.projectKey || (matches ? matches[1] : ""),
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
    try {
      const contexts = await fetchProjectIssuePromptContexts(projectId, selectedIssues);
      onImport(contexts);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to import Jira issues.");
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 lg:p-12">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-void-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[2.2rem] border border-black/[0.08] bg-white shadow-[0_24px_54px_rgba(15,23,42,0.18)] dark:border-white/[0.08] dark:bg-void-800"
        style={{ maxHeight: "calc(100vh - 4rem)" }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:px-7 sm:py-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] bg-[#0052CC]/10 text-[#0052CC] dark:bg-[#4C9AFF]/15 dark:text-[#4C9AFF]">
              <JiraIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Import from Jira</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Search Jira, select issues, and attach them to the sprint composer.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-slate-500 transition-colors hover:bg-black/[0.08] hover:text-slate-900 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-white"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="flex shrink-0 flex-col gap-4 border-b border-black/[0.06] bg-slate-50/50 p-5 dark:border-white/[0.06] dark:bg-white/[0.02] sm:px-7 sm:py-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1 relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={jql}
                onInput={(event) => setJql((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="project = PROJ ORDER BY updated DESC"
                className="h-12 w-full rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
              />
            </div>
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-slate-900 px-5 text-xs font-black uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
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
          ) : results !== null && results.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-black/[0.1] p-10 text-center text-sm font-semibold text-slate-400 dark:border-white/[0.1]">
              No issues found. Try a different JQL query.
            </div>
          ) : results !== null && results.length > 0 ? (
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
                        ? "border-[#0052CC]/35 bg-[#0052CC]/[0.08] shadow-[0_14px_32px_rgba(0,82,204,0.08)] dark:border-[#4C9AFF]/35 dark:bg-[#4C9AFF]/[0.12] dark:shadow-[0_14px_32px_rgba(76,154,255,0.12)]"
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
                          <span className="text-[#0052CC] dark:text-[#4C9AFF] font-mono">{issue.key}</span>
                        </div>
                        <div className="mt-1 text-sm font-black leading-snug text-slate-900 dark:text-white">
                          {issue.title}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                          <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                            {issue.state}
                          </span>
                          {(issue.assignees || []).map((assignee: string) => (
                             <span key={assignee} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
                               {assignee}
                             </span>
                          ))}
                          {(issue.labels || []).slice(0, 6).map((label: string) => (
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
                          Append Conversation
                        </label>
                      </div>
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
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
          ) : null}
        </main>

        <footer className="flex flex-col gap-3 border-t border-black/[0.06] p-5 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex h-6 items-center">
            {selectedKeys.size > 0 && (
              <span className="inline-flex items-center rounded-full bg-[#0052CC]/10 px-3 py-1 text-xs font-bold text-[#0052CC] dark:bg-[#4C9AFF]/15 dark:text-[#4C9AFF]">
                {selectedKeys.size} issue{selectedKeys.size === 1 ? "" : "s"} selected
              </span>
            )}
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
              disabled={selectedKeys.size === 0 || importing}
              className="rounded-[1rem] bg-[#0052CC] px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,82,204,0.2)] transition-all hover:-translate-y-px hover:bg-[#0047b3] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4C9AFF] dark:text-slate-900 dark:shadow-[0_12px_28px_rgba(76,154,255,0.2)] dark:hover:bg-[#3b85e0]"
            >
              {importing ? "Linking..." : "Link to Sprint"}
            </button>
          </div>
        </footer>
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
