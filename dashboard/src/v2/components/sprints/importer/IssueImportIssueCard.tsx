import type { ComponentChildren, FunctionComponent } from "preact";
import { Check, ExternalLink, MessageSquare, Tag, UserRound } from "lucide-preact";
import type {
  IssueImportMetadataRow,
  IssueImportProviderMetadata,
  IssueImportTruncatedList,
} from "../../../lib/issue-import-view-models.js";
import { getSafeUrl } from "../../../lib/safe-url.js";

interface IssueImportIssueCardProps {
  provider: IssueImportProviderMetadata;
  issueKey: string;
  title: string;
  url?: string | null;
  bodyPreview?: string | null;
  selected: boolean;
  includeConversation: boolean;
  metadataRows: IssueImportMetadataRow[];
  labels: IssueImportTruncatedList;
  assignees: IssueImportTruncatedList;
  selectionLabel?: string;
  modeLabel?: string | null;
  icon?: ComponentChildren;
  compact?: boolean;
  metadataLimit?: number;
  onToggle: () => void;
  onToggleConversation: () => void;
}

export const IssueImportIssueCard: FunctionComponent<IssueImportIssueCardProps> = ({
  provider,
  issueKey,
  title,
  url,
  bodyPreview,
  selected,
  includeConversation,
  metadataRows,
  labels,
  assignees,
  selectionLabel,
  modeLabel,
  icon,
  compact = false,
  metadataLimit,
  onToggle,
  onToggleConversation,
}) => {
  const safeUrl = getSafeUrl(url ?? "");
  const visibleMetadataRows = typeof metadataLimit === "number"
    ? metadataRows.slice(0, Math.max(0, Math.trunc(metadataLimit)))
    : metadataRows;
  const metadataOverflowCount = Math.max(0, metadataRows.length - visibleMetadataRows.length);
  const cardTone = selected
    ? provider.accent.selectedCardClassName
    : "border-black/[0.06] bg-black/[0.02] hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white/82 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.055]";
  const iconTone = selected
    ? provider.accent.selectedIconClassName
    : "bg-slate-900/[0.06] text-slate-500 dark:bg-white/[0.06] dark:text-slate-300";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group rounded-[1.25rem] border text-left transition-all focus-visible:outline-none focus-visible:ring-2 ${provider.accent.focusRingClassName} ${compact ? "p-3" : "p-4"} ${cardTone}`}
    >
      <div className={`flex items-start ${compact ? "gap-3" : "gap-4"}`}>
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.85rem] ${iconTone}`}>
          {selected ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /> : icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <span className="font-mono text-slate-700 dark:text-slate-200">{issueKey}</span>
            {modeLabel && (
              <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                {modeLabel}
              </span>
            )}
          </div>

          <div className="mt-1 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
            {title}
          </div>

          {bodyPreview && !compact && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {bodyPreview}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {visibleMetadataRows.map((row) => (
              <span
                key={row.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]"
              >
                <span className="text-slate-400 dark:text-slate-500">{row.label}</span>
                <span className="truncate">{row.value}</span>
              </span>
            ))}
            {metadataOverflowCount > 0 && <OverflowPill label={`+${metadataOverflowCount} details`} />}
            {assignees.visible.map((assignee) => (
              <span
                key={assignee}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]"
              >
                <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{assignee}</span>
              </span>
            ))}
            {assignees.overflowLabel && <OverflowPill label={assignees.overflowLabel} />}
            {labels.visible.map((label) => (
              <span
                key={label}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]"
              >
                <Tag className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </span>
            ))}
            {labels.overflowLabel && <OverflowPill label={labels.overflowLabel} />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={includeConversation}
                onChange={onToggleConversation}
                className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
              />
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
              Append Conversation
            </label>
            <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300">
              <span aria-live="polite">{selectionLabel ?? (selected ? "Selected" : "Click to select")}</span>
            </span>
          </div>
        </div>

        {safeUrl ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 ${provider.accent.focusRingClassName} dark:hover:bg-white/[0.06] dark:hover:text-white`}
            aria-label={`Open ${issueKey}`}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
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
};

const OverflowPill: FunctionComponent<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.06]">
    {label}
  </span>
);
