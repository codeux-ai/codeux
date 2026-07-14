import type { FunctionComponent } from "preact";
import {
  ExternalLink,
  Github,
  Gitlab,
  Link2,
  MessageSquare,
  MessageSquareOff,
  Tag,
  Users,
  X,
} from "lucide-preact";
import { getSafeUrl } from "../../lib/safe-url.js";
import type { LinkedIssueProvider } from "../../types.js";
import { JiraIcon } from "../icons/JiraIcon.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

export interface LinkedIssueTagProps {
  issue: {
    id?: string;
    provider?: LinkedIssueProvider;
    repository?: string;
    projectKey?: string;
    issueNumber?: number | null;
    externalId?: string | null;
    sourceKind?: string;
    issueKey?: string;
    title: string;
    url?: string;
    state?: string;
    status?: string;
    labels?: string[];
    assignees?: string[];
    includeConversation?: boolean;
  };
  variant?: "tag" | "composer-card";
  disabled?: boolean;
  onRemove?: (issue: LinkedIssueTagProps["issue"]) => void;
}

const providerLabel = (provider: LinkedIssueTagProps["issue"]["provider"], fallback: string): string => {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  if (provider === "jira") return "Jira";
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : fallback;
};

const getProviderClasses = (provider: LinkedIssueTagProps["issue"]["provider"]): string => {
  if (provider === "jira") {
    return "border-[#0052CC]/20 bg-[#0052CC]/10 text-[#0052CC] dark:border-[#4C9AFF]/20 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF]";
  }
  if (provider === "gitlab") {
    return "border-ember-500/20 bg-ember-500/10 text-ember-600 dark:text-ember-400";
  }
  return "border-slate-900/10 bg-slate-900/[0.06] text-slate-800 dark:border-white/10 dark:bg-white/[0.07] dark:text-white";
};

const getStateClasses = (state?: string): string => {
  const normalized = (state || "").toLowerCase();
  if (normalized === "done" || normalized === "completed" || normalized === "closed" || normalized === "resolved") {
    return "border-status-green/20 bg-status-green/10 text-status-green";
  }
  if (normalized === "blocked" || normalized === "failed") {
    return "border-status-red/20 bg-status-red/10 text-status-red";
  }
  return "border-signal-500/18 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300";
};

const ProviderIcon = ({ provider }: { provider: LinkedIssueTagProps["issue"]["provider"] }) => {
  if (provider === "gitlab") {
    return <Gitlab className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "jira") {
    return (
      <span aria-hidden="true" className="inline-flex h-4 w-4">
        <JiraIcon className="h-4 w-4" />
      </span>
    );
  }
  if (provider === "github" || !provider) {
    return <Github className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />;
  }
  return <Link2 className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />;
};

export const LinkedIssueTag: FunctionComponent<LinkedIssueTagProps> = ({
  issue,
  variant = "tag",
  disabled = false,
  onRemove,
}) => {
  const { translate } = useDashboardI18n();
  const issueKey = issue.issueKey || (typeof issue.issueNumber === "number" ? `#${issue.issueNumber}` : translate(sprintsMessages, "issue"));

  if (variant === "composer-card") {
    const providerName = providerLabel(issue.provider, translate(sprintsMessages, "issue"));
    const projectLabel = issue.projectKey || issue.repository || translate(sprintsMessages, "unmappedProject");
    const stateLabel = issue.state || issue.status || translate(sprintsMessages, "noState");
    const labels = issue.labels || [];
    const assignees = issue.assignees || [];
    const conversationIncluded = issue.includeConversation === true;
    const safeUrl = issue.url ? getSafeUrl(issue.url) : "";

    return (
      <article className="group relative min-w-0 overflow-hidden rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 transition-all hover:-translate-y-0.5 hover:border-signal-500/24 hover:bg-white/88 focus-within:border-signal-500/40 focus-within:ring-2 focus-within:ring-signal-500/18 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:bg-white/[0.055]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-signal-500 via-ember-500 to-slate-300 opacity-70" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border ${getProviderClasses(issue.provider)}`}>
            <ProviderIcon provider={issue.provider} />
            <span className="sr-only">{providerName}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              <span className="rounded-full border border-black/[0.05] bg-white/70 px-2 py-1 text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                {providerName}
              </span>
              <span className="min-w-0 break-all">{projectLabel}</span>
              <span className="shrink-0 text-signal-600 dark:text-signal-300">{issueKey}</span>
            </div>
            <h3 className="mt-2 min-w-0 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
              {issue.title}
            </h3>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/70 dark:hover:bg-white/[0.06] dark:hover:text-white"
                aria-label={translate(sprintsMessages, "openSourceIssue", { key: issueKey, title: issue.title })}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              </a>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(issue)}
                disabled={disabled}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-status-red/10 hover:text-status-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={translate(sprintsMessages, "removeLinkedIssue", { key: issueKey, title: issue.title })}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${getStateClasses(stateLabel)}`}>
            <span className="break-words">{stateLabel}</span>
          </span>
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/[0.05] bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
            {conversationIncluded ? (
              <MessageSquare className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            ) : (
              <MessageSquareOff className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            )}
            <span>{translate(sprintsMessages, conversationIncluded ? "conversationIncluded" : "conversationOmitted")}</span>
          </span>
          {labels.slice(0, 5).map((label) => (
            <span key={label} className="inline-flex max-w-full items-center gap-1 rounded-full bg-signal-500/[0.08] px-2 py-1 text-[10px] font-semibold text-signal-700 dark:text-signal-300">
              <Tag className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 break-words">{label}</span>
            </span>
          ))}
          {assignees.slice(0, 3).map((assignee) => (
            <span key={assignee} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ember-500/[0.09] px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <Users className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 break-words">{assignee}</span>
            </span>
          ))}
        </div>
      </article>
    );
  }

  let bg = "bg-[var(--bg-status-info-subtle)]";
  let text = "text-[var(--text-status-info-bold)]";
  let border = "border-[var(--border-status-info-subtle)]";

  if (issue.status) {
    const s = issue.status.toLowerCase();
    if (s === "done" || s === "completed") {
      bg = "bg-[var(--bg-status-success-subtle)]";
      text = "text-[var(--text-status-success-bold)]";
      border = "border-[var(--border-status-success-subtle)]";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-[8px] h-[20px] text-[11px] font-medium ${bg} ${text} ${border} dark:!bg-white/[0.04] dark:!border-white/[0.1] dark:!text-slate-300`}
      title={issue.title}
    >
      <Link2 className="h-3 w-3" strokeWidth={2.2} />
      {issueKey}
    </span>
  );
};
