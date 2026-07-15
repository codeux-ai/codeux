import { type FunctionComponent } from "preact";
import { CircleDot, ExternalLink, GitMerge, GitPullRequest, Ticket } from "lucide-preact";
import { ChatWidgetFrame, type ExecutionStatus } from "./ChatWidgetFrame.js";
import type { ExternalReferenceKind, ExternalReferenceWidgetState } from "../../../lib/chat-widget-view-models.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages } from "../../../i18n/messages/chat.js";

export interface ExternalReferenceWidgetProps {
  reference: ExternalReferenceWidgetState;
  status: ExecutionStatus;
}

const providerTone: Record<ExternalReferenceWidgetState["provider"], string> = {
  jira: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  github: "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  gitlab: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

const safeExternalUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const ReferenceIcon: FunctionComponent<{ kind: ExternalReferenceKind }> = ({ kind }) => {
  switch (kind) {
    case "pull_request":
      return <GitPullRequest className="h-4 w-4" aria-hidden="true" />;
    case "merge_request":
      return <GitMerge className="h-4 w-4" aria-hidden="true" />;
    case "issue":
      return <CircleDot className="h-4 w-4" aria-hidden="true" />;
  }
};

const MetadataChip: FunctionComponent<{ label: string; value: string }> = ({ label, value }) => (
  <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-black/[0.06] bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
    <span className="shrink-0 text-slate-400">{label}</span>
    <span className="min-w-0 break-words font-semibold text-slate-700 dark:text-slate-200">{value}</span>
  </span>
);

export const ExternalReferenceWidget: FunctionComponent<ExternalReferenceWidgetProps> = ({
  reference,
  status,
}) => {
  const { translate } = useDashboardI18n();
  const url = safeExternalUrl(reference.url);
  const path = reference.repositoryPath ?? reference.projectPath;
  const hasMetadata = Boolean(reference.stateLabel || path || reference.assignee || reference.author || reference.labels.length > 0);

  return (
    <ChatWidgetFrame
      status={status}
      header={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${providerTone[reference.provider]}`}>
              <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{reference.providerLabel}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-700 dark:text-slate-300">
              <ReferenceIcon kind={reference.kind} />
              <span className="min-w-0 truncate">{reference.kindLabel}</span>
            </span>
          </div>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-black/[0.06] bg-white/75 px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:border-signal-500/40 hover:text-signal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:text-signal-300"
              aria-label={translate(chatMessages, "openExternalReference", { provider: reference.providerLabel, kind: reference.kindLabel, title: reference.title })}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{translate(chatMessages, "open")}</span>
            </a>
          ) : null}
        </div>
      }
    >
      <article className="min-w-0 space-y-3" aria-label={reference.ariaLabel}>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {reference.identifierLabel ? (
              <span className="max-w-full rounded-md bg-slate-900 px-2 py-1 font-mono text-[11px] font-bold text-white break-words dark:bg-white dark:text-slate-950">
                {reference.identifierLabel}
              </span>
            ) : null}
            {reference.stateLabel ? (
              <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                {reference.stateLabel}
              </span>
            ) : null}
          </div>
          <h3 className="m-0 text-[15px] font-semibold leading-6 text-slate-950 break-words dark:text-white">
            {reference.title}
          </h3>
        </div>

        {hasMetadata ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {path ? <MetadataChip label={translate(chatMessages, reference.repositoryPath ? "repo" : "project")} value={path} /> : null}
            {reference.assignee ? <MetadataChip label={translate(chatMessages, "assignee")} value={reference.assignee} /> : null}
            {reference.author ? <MetadataChip label={translate(chatMessages, "author")} value={reference.author} /> : null}
            {reference.labels.map((label) => (
              <span
                key={label}
                className="max-w-full rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-[11px] font-semibold text-signal-700 break-words dark:text-signal-300"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {reference.preview ? (
          <p className="m-0 border-l-2 border-slate-300/80 pl-3 text-[13px] leading-6 text-slate-600 break-words dark:border-white/15 dark:text-slate-300">
            {reference.preview}
          </p>
        ) : null}
      </article>
    </ChatWidgetFrame>
  );
};
