import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { ExternalLink, MessageSquareText, Timer } from "lucide-preact";

import { formatTime } from "../../../lib/time.js";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { formatInvocationDuration, formatInvocationPurpose } from "../chat/invocation-display.js";

const INVOCATION_STATUS_DOT: Record<string, string> = {
  running: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.55)]",
  completed: "bg-status-green",
  failed: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.35)]",
  cancelled: "bg-slate-400",
  paused: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.35)]",
};

const INVOCATION_STATUS_TEXT: Record<string, string> = {
  running: "text-signal-500",
  completed: "text-status-green",
  failed: "text-status-red",
  cancelled: "text-slate-400",
  paused: "text-status-amber",
};

export const buildInvocationHref = (invocationId: string): string => (
  `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`
);

const shortenInvocationId = (value: string): string => value.slice(0, 8);

export const LiveTaskInvocationRow: FunctionComponent<{
  invocation: ExecutionInvocationRecord;
}> = memo(({ invocation }) => {
  const purposeLabel = formatInvocationPurpose(invocation.type);
  const activityAt = invocation.lastMessageAt || invocation.updatedAt || invocation.startedAt || invocation.createdAt;
  const duration = formatInvocationDuration(invocation.startedAt || invocation.createdAt, invocation.finishedAt);
  const tokenTotal = invocation.totalTokens ?? ((invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0));
  const statusDot = INVOCATION_STATUS_DOT[invocation.status] || "bg-slate-400";
  const statusText = INVOCATION_STATUS_TEXT[invocation.status] || "text-slate-500";

  return (
    <div className="rounded-xl border border-black/[0.04] bg-white/60 p-3 dark:border-white/[0.05] dark:bg-void-900/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot} ${invocation.status === "running" ? "motion-safe:animate-pulse motion-reduce:ring-2 motion-reduce:ring-signal-500/25" : ""}`} />
            <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
              {purposeLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>{invocation.provider || "provider pending"}</span>
            <span>·</span>
            <span>{invocation.model || "model pending"}</span>
            <span>·</span>
            <span>{shortenInvocationId(invocation.id)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusText}`}>
            {invocation.status}
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400">
            {formatTime(activityAt)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
          <MessageSquareText className="h-3 w-3" strokeWidth={2} />
          {invocation.messageCount}
        </span>
        {duration && (
          <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            <Timer className="h-3 w-3" strokeWidth={2} />
            {duration}
          </span>
        )}
        {tokenTotal > 0 && (
          <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            {tokenTotal.toLocaleString()} tok
          </span>
        )}
        <a
          href={buildInvocationHref(invocation.id)}
          aria-label={`Open transcript for ${purposeLabel}`}
          className="inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-signal-400 dark:focus-visible:ring-offset-void-800"
        >
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
          Transcript
        </a>
      </div>

      {invocation.lastErrorMessage && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-status-red">
          {invocation.lastErrorMessage}
        </p>
      )}
    </div>
  );
});
