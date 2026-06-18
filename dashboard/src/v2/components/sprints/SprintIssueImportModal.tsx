import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Check,
  ExternalLink,
  Filter,
  Github,
  Gitlab,
  Loader2,
  MessageSquare,
  Search,
  Tag,
  X,
} from "lucide-preact";
import type { ProjectSummary, SprintLinkedIssueInput } from "../../types.js";
import { fetchProjectIssuePromptContexts, searchProjectIssues, type RemoteIssueSummary } from "../../lib/project-api.js";
import { MultiSelect } from "../ui/MultiSelect.js";
import { getSafeUrl } from "../../lib/safe-url.js";

interface SprintIssueImportModalProps {
  project: ProjectSummary;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void;
}

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

export const SprintIssueImportModal: FunctionComponent<SprintIssueImportModalProps> = ({
  project,
  onClose,
  onImport,
}) => {
  const [provider, setProvider] = useState<"github" | "gitlab">(
    project.gitProvider === "gitlab" ? "gitlab" : "github",
  );
  const [repository, setRepository] = useState(inferRepository(project));
  const [search, setSearch] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [issues, setIssues] = useState<RemoteIssueSummary[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hostDomain = project.gitHostDomain || (provider === "gitlab" ? "gitlab.com" : "github.com");
  const selectedIssues = useMemo(() => (
    issues.filter((issue) => selectedKeys.has(issueKey(issue)))
  ), [issues, selectedKeys]);

  const runSearch = async (): Promise<void> => {
    if (!repository.trim()) {
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
        provider,
        repository,
        hostDomain,
        search,
        state,
        labels,
        limit: 40,
      }, controller.signal);
      setIssues(results);
      setSelectedKeys((current) => new Set([...current].filter((key) => results.some((issue) => issueKey(issue) === key))));
      setConversationDisabledKeys((current) => new Set([...current].filter((key) => results.some((issue) => issueKey(issue) === key))));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setIssues([]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    void runSearch();
    return () => abortRef.current?.abort();
  }, []);

  const toggleIssue = (issue: RemoteIssueSummary): void => {
    const key = issueKey(issue);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleConversation = (issue: RemoteIssueSummary): void => {
    const key = issueKey(issue);
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleImport = async (): Promise<void> => {
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
      onImport(contexts);
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
            LINK
          </span>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`h-52 w-52 animate-organic ${
                provider === "gitlab" ? "bg-ember-500/[0.12]" : "bg-[#2F81F7]/[0.11]"
              }`}
              style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
            />
            <div
              className={`absolute h-32 w-32 animate-organic-reverse ${
                provider === "gitlab" ? "bg-status-red/[0.12]" : "bg-signal-500/[0.12]"
              }`}
              style={{ borderRadius: "60% 40% 35% 65% / 55% 42% 58% 45%" }}
            />
            <div
              className="absolute h-72 w-72 animate-[spin_22s_linear_infinite] border border-white/[0.045]"
              style={{ borderRadius: "46% 54% 60% 40% / 48% 42% 58% 52%" }}
            />
          </div>
          <div className="relative z-10">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              provider === "gitlab"
                ? "border-ember-500/22 bg-ember-500/10 text-ember-300"
                : "border-[#2F81F7]/25 bg-[#2F81F7]/10 text-[#9ecbff]"
            }`}>
              <Filter className="h-3.5 w-3.5" strokeWidth={2.2} />
              Backlog Import
            </div>
            <h2 className="mt-6 font-display text-4xl font-black leading-[0.95] tracking-tight">
              Select Issues.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/52">
              Search the repository backlog, select one or many issues, then link them into the sprint composer.
            </p>
          </div>
          <div className="relative z-10 grid gap-3">
            {[
              ["Provider", provider === "github" ? "GitHub" : "GitLab"],
              ["Repository", repository || "not set"],
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
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">
                GitHub / GitLab Issues
              </div>
              <h2 className="mt-2 font-display text-3xl font-black leading-none text-slate-900 dark:text-white">
                Import Backlog Scope
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 transition-colors hover:bg-black/[0.08] hover:text-slate-900 dark:bg-white/[0.05] dark:hover:text-white"
              aria-label="Close issue import"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="grid gap-4 border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
            <div className="grid grid-cols-2 gap-2 rounded-[1.1rem] bg-black/[0.035] p-1 dark:bg-white/[0.04]">
              {(["github", "gitlab"] as const).map((id) => {
                const Icon = id === "github" ? Github : Gitlab;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setProvider(id)}
                    className={`inline-flex h-10 items-center justify-center rounded-[0.85rem] transition-all ${
                      provider === id
                        ? "bg-white text-slate-900 shadow-sm dark:bg-white/12 dark:text-white"
                        : "text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                    aria-label={id === "github" ? "GitHub" : "GitLab"}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                );
              })}
            </div>
            <input
              value={repository}
              onInput={(event) => setRepository((event.target as HTMLInputElement).value)}
              placeholder="owner/repository"
              className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] px-4 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="Search title or body"
                className="h-12 w-full rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] pl-11 pr-4 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200"
              />
            </div>
            <select
              value={state}
              onChange={(event) => setState((event.target as HTMLSelectElement).value as "open" | "closed" | "all")}
              className="h-12 rounded-[1.1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
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
                placeholder="Optional labels filter, press Enter to add"
              />
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
            ) : issues.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-black/[0.1] p-10 text-center text-sm font-semibold text-slate-400 dark:border-white/[0.1]">
                No issues found for the current filters.
              </div>
            ) : (
              <div className="grid gap-3">
                {issues.map((issue) => {
                  const selected = selectedKeys.has(issueKey(issue));
                  const ProviderIcon = issue.provider === "gitlab" ? Gitlab : Github;
                  return (
                    <button
                      key={issueKey(issue)}
                      type="button"
                      onClick={() => toggleIssue(issue)}
                      className={`group rounded-[1.35rem] border p-4 text-left transition-all ${
                        selected
                          ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_14px_32px_rgba(0,224,160,0.08)]"
                          : "border-black/[0.06] bg-black/[0.02] hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white/82 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.055]"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.85rem] ${
                          selected ? "bg-signal-500 text-slate-950" : "bg-slate-900/[0.06] text-slate-500 dark:bg-white/[0.06] dark:text-slate-300"
                        }`}>
                          {selected ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <ProviderIcon className="h-4 w-4" strokeWidth={2.1} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                            <span>{issue.repository}</span>
                            <span className="text-signal-600 dark:text-signal-300">{issue.issueKey}</span>
                          </div>
                          <div className="mt-1 text-sm font-black leading-snug text-slate-900 dark:text-white">
                            {issue.title}
                          </div>
                          {issue.bodyPreview && (
                            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                              {issue.bodyPreview}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-1.5">
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
                              checked={!conversationDisabledKeys.has(issueKey(issue))}
                              onChange={() => toggleConversation(issue)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
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
                          aria-label={`Open ${issue.title}`}
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={2.1} />
                        </a>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </main>

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
                className="rounded-[1rem] bg-signal-500 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_12px_28px_rgba(0,224,160,0.2)] transition-all hover:-translate-y-px hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
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

function issueKey(issue: SprintLinkedIssueInput): string {
  return `${issue.provider}:${issue.hostDomain}:${issue.repository}:${issue.issueNumber}`;
}
