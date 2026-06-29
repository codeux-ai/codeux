import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState } from "preact/hooks";
import { ChevronDown, Cpu, ExternalLink, MessageSquareText, Timer } from "lucide-preact";
import { formatTime } from "../../../lib/time.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { formatInvocationDuration, formatInvocationPurpose, InvocationContextChips } from "../chat/invocation-display.js";
import { statusRailTone, statusTone, shortenRuntimeId } from "./ExecutionRuntimePanel.js";

const INVOCATION_STATUS_DOT: Record<string, string> = {
  running: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.55)]",
  completed: "bg-status-green",
  failed: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.35)]",
  cancelled: "bg-slate-400",
  paused: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.35)]",
};

const buildInvocationHref = (invocationId: string): string => (
  `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`
);

const getInvocationActivityAt = (invocation: ExecutionInvocationRecord): string => (
  invocation.lastMessageAt || invocation.updatedAt || invocation.startedAt || invocation.createdAt
);

const InvocationFeedRow: FunctionComponent<{
  invocation: ExecutionInvocationRecord;
  sprintKeyPrefix?: string;
}> = memo(({ invocation, sprintKeyPrefix = "SPR" }) => {
  const activityAt = getInvocationActivityAt(invocation);
  const duration = formatInvocationDuration(invocation.startedAt || invocation.createdAt, invocation.finishedAt);
  const tokenTotal = invocation.totalTokens ?? ((invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0));
  const dotClass = INVOCATION_STATUS_DOT[invocation.status] || "bg-slate-400";
  const providerLabel = invocation.provider || "provider pending";
  const modelLabel = invocation.model || "model pending";

  const purposeLabel = formatInvocationPurpose(invocation.type);

  return (
    <div className={`group/row rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(invocation.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dotClass} ${invocation.status === "running" ? "animate-pulse" : ""}`} />
            <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
              {purposeLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>{providerLabel}</span>
            <span>·</span>
            <span>{modelLabel}</span>
            <span>·</span>
            <span>{shortenRuntimeId(invocation.id)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(invocation.status)}`}>
            {invocation.status}
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400">
            {formatTime(activityAt)}
          </div>
          <a
            href={buildInvocationHref(invocation.id)}
            aria-label={`Open transcript for ${purposeLabel}`}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-signal-400 dark:focus-visible:ring-offset-void-800"
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            Transcript
          </a>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <InvocationContextChips invocation={invocation} sprintKeyPrefix={sprintKeyPrefix} />
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
      </div>

      {invocation.lastErrorMessage && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-status-red">
          {invocation.lastErrorMessage}
        </p>
      )}
    </div>
  );
});

export const InvocationFeedPanel: FunctionComponent<{
  collapsible?: boolean;
  defaultOpen?: boolean;
  invocations?: ExecutionInvocationRecord[];
  sprintKeyPrefix?: string;
}> = memo(({
  collapsible = false,
  defaultOpen = true,
  invocations: scopedInvocations,
  sprintKeyPrefix = "SPR",
}) => {
  const { execution: snapshot } = useExecutionTimeline();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  const invocations = useMemo(
    () => scopedInvocations ?? snapshot?.recentInvocations ?? [],
    [scopedInvocations, snapshot?.recentInvocations],
  );

  const runningCount = useMemo(
    () => invocations.filter((invocation) => invocation.status === "running").length,
    [invocations],
  );
  const failedCount = useMemo(
    () => invocations.filter((invocation) => invocation.status === "failed").length,
    [invocations],
  );
  const completedCount = useMemo(
    () => invocations.filter((invocation) => invocation.status === "completed").length,
    [invocations],
  );

  if (!snapshot) return null;

  const header = (
    <div className="flex flex-wrap items-center gap-2.5">
      <Cpu className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Invocation Feed</span>
      {runningCount > 0 && (
        <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
          {runningCount} live
        </span>
      )}
    </div>
  );

  return (
    <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-void-800">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
          className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-200 hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
        >
          {header}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
            strokeWidth={2}
          />
        </button>
      ) : (
        <div className="relative z-10 flex items-center justify-between gap-4 p-5">
          {header}
        </div>
      )}

      <div className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""} id={contentId}>
        <div className={collapsible ? "collapsible-content" : ""}>
          <div className="relative z-10 px-5 pb-5 pt-0">
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[
                { label: "Running", value: runningCount, tone: "text-signal-500" },
                { label: "Done", value: completedCount, tone: "text-status-green" },
                { label: "Failed", value: failedCount, tone: "text-status-red" },
              ].map(({ label, value, tone }) => (
                <div key={label} className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30">
                  <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${tone}`}>{label}</div>
                  <div className={`mt-1 font-mono text-lg font-black leading-none ${tone}`}>{value}</div>
                </div>
              ))}
            </div>

            {invocations.length === 0 ? (
              <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                No invocation records yet.
              </p>
            ) : (
              <div
                role="log"
                aria-label="Live invocation feed"
                aria-live="polite"
                aria-relevant="additions text"
                className="max-h-96 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar"
              >
                {invocations.map((invocation) => (
                  <InvocationFeedRow
                    key={invocation.id}
                    invocation={invocation}
                    sprintKeyPrefix={sprintKeyPrefix}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
