import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { ExternalLink, MessageSquareText, Timer } from "lucide-preact";

import { getInvocationContainerBuildProgress } from "../../../lib/activity.js";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { formatInvocationDuration, formatInvocationPurpose } from "../chat/invocation-display.js";
import { ContainerBuildStatusInfobox } from "./ContainerBuildStatusInfobox.js";
import { formatDuration } from "../../lib/format-duration.js";
import { useLiveI18n, type LiveMessageKey } from "../../i18n/messages/live.js";

const INVOCATION_STATUS_DOT: Record<string, string> = {
  running: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.55)] motion-reduce:ring-2 motion-reduce:ring-signal-500/25 motion-reduce:shadow-none",
  completed: "bg-status-green motion-reduce:ring-2 motion-reduce:ring-status-green/25",
  failed: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.35)] motion-reduce:ring-2 motion-reduce:ring-status-red/25 motion-reduce:shadow-none",
  cancelled: "bg-slate-400",
  paused: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.35)] motion-reduce:ring-2 motion-reduce:ring-status-amber/25 motion-reduce:shadow-none",
};

const INVOCATION_STATUS_TEXT: Record<string, string> = {
  running: "text-signal-500",
  completed: "text-status-green",
  failed: "text-status-red",
  cancelled: "text-slate-400",
  paused: "text-status-amber",
};

const INVOCATION_PURPOSE_KEYS: Partial<Record<string, LiveMessageKey>> = {
  planning: "planning",
  cli_task_coding: "taskCoding",
  cli_task_review: "taskReview",
  cli_qa: "qaReview",
  qa_review: "qaReview",
  dashboard_reply: "chatReply",
  worker_dispatch: "workerDispatch",
};

const INVOCATION_STATUS_KEYS: Partial<Record<string, LiveMessageKey>> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  paused: "paused",
  pending: "pending",
  queued: "queued",
};

export const buildInvocationHref = (invocationId: string): string => (
  `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`
);

const shortenInvocationId = (value: string): string => value.slice(0, 8);

export const LiveTaskInvocationRow: FunctionComponent<{
  invocation: ExecutionInvocationRecord;
}> = memo(({ invocation }) => {
  const { locale, t, tp, formatNumber, formatTime } = useLiveI18n();
  const purposeKey = INVOCATION_PURPOSE_KEYS[invocation.type ?? ""];
  const purposeLabel = purposeKey ? t(purposeKey) : formatInvocationPurpose(invocation.type);
  const activityAt = invocation.lastMessageAt || invocation.updatedAt || invocation.startedAt || invocation.createdAt;
  const rawDuration = formatInvocationDuration(invocation.startedAt || invocation.createdAt, invocation.finishedAt);
  const durationStart = Date.parse(invocation.startedAt || invocation.createdAt);
  const durationEnd = invocation.finishedAt ? Date.parse(invocation.finishedAt) : Date.now();
  const duration = Number.isFinite(durationStart) && Number.isFinite(durationEnd) && durationEnd >= durationStart
    ? formatDuration(Math.round((durationEnd - durationStart) / 1000), locale)
    : rawDuration;
  const tokenTotal = invocation.totalTokens ?? ((invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0));
  const statusDot = INVOCATION_STATUS_DOT[invocation.status] || "bg-slate-400";
  const statusText = INVOCATION_STATUS_TEXT[invocation.status] || "text-slate-500";
  const statusKey = INVOCATION_STATUS_KEYS[invocation.status];
  const statusLabel = locale === "en" ? invocation.status : statusKey ? t(statusKey) : invocation.status;
  const containerBuildProgress = getInvocationContainerBuildProgress(invocation);

  return (
    <div className="rounded-xl border border-black/[0.04] bg-white/60 p-3 transition-colors duration-[var(--interaction-list-reveal-duration)] ease-[var(--interaction-list-reveal-ease)] motion-reduce:transition-none dark:border-white/[0.05] dark:bg-void-900/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot} ${invocation.status === "running" ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
            <span className="sr-only">{t("invocationStatus", { status: statusLabel })}</span>
            <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
              {purposeLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>{invocation.provider || t("providerPending")}</span>
            <span>·</span>
            <span>{invocation.model || t("modelPending")}</span>
            <span>·</span>
            <span>{shortenInvocationId(invocation.id)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusText}`}>
            {statusLabel}
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400">
            {formatTime(new Date(activityAt))}
          </div>
        </div>
      </div>

      <ContainerBuildStatusInfobox progress={containerBuildProgress} className="mt-3" />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
          <MessageSquareText className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          {tp("messages", invocation.messageCount, { count: formatNumber(invocation.messageCount) })}
        </span>
        {duration && (
          <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            <Timer className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {duration}
          </span>
        )}
        {tokenTotal > 0 && (
          <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            {t("tokensShort", { count: formatNumber(tokenTotal) })}
          </span>
        )}
        <a
          href={buildInvocationHref(invocation.id)}
          aria-label={t("openTranscript", { purpose: purposeLabel, id: shortenInvocationId(invocation.id) })}
          className="inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-signal-400 dark:focus-visible:ring-offset-void-800"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          {t("transcript")}
        </a>
      </div>

      {invocation.lastErrorMessage && (
        <p role="alert" className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-status-red">
          {invocation.lastErrorMessage}
        </p>
      )}
    </div>
  );
});
