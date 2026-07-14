import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { ChevronDown, Cpu, ExternalLink, MessageSquareText, Timer } from "lucide-preact";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { findLatestContainerBuildProgressFromEvents, findLatestContainerBuildProgressFromInvocations } from "../../../lib/activity.js";
import { formatInvocationDuration, formatInvocationPurpose, InvocationContextChips } from "../chat/invocation-display.js";
import { RuntimeSnapshotSurfaceBadge, RuntimeSnapshotSurfaceNotice, statusRailTone, statusTone, shortenRuntimeId } from "./ExecutionRuntimePanel.js";
import { ContainerBuildStatusInfobox } from "./ContainerBuildStatusInfobox.js";
import { formatDuration } from "../../lib/format-duration.js";
import { useLiveI18n, type LiveMessageKey } from "../../i18n/messages/live.js";

const INVOCATION_STATUS_DOT: Record<string, string> = {
  running: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.35)] motion-reduce:ring-2 motion-reduce:ring-signal-500/30 motion-reduce:shadow-none",
  completed: "bg-status-green motion-reduce:ring-2 motion-reduce:ring-status-green/25",
  failed: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.25)] motion-reduce:ring-2 motion-reduce:ring-status-red/25 motion-reduce:shadow-none",
  cancelled: "bg-slate-400",
  paused: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.25)] motion-reduce:ring-2 motion-reduce:ring-status-amber/25 motion-reduce:shadow-none",
};

const buildInvocationHref = (invocationId: string): string => (
  `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`
);

const getInvocationActivityAt = (invocation: ExecutionInvocationRecord): string => (
  invocation.lastMessageAt || invocation.updatedAt || invocation.startedAt || invocation.createdAt
);

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

const InvocationFeedRow: FunctionComponent<{
  invocation: ExecutionInvocationRecord;
  sprintKeyPrefix?: string;
}> = memo(({ invocation, sprintKeyPrefix = "SPR" }) => {
  const { locale, t, tp, formatNumber, formatTime } = useLiveI18n();
  const rowRef = useRef<HTMLDivElement>(null);
  const isReducedMotion = useReducedMotion();
  const motionTokens = useGsapInteractionTokens();
  const prevStatusRef = useRef(invocation.status);
  const prevStatus = prevStatusRef.current;
  const statusChanged = prevStatus !== invocation.status;

  useLayoutEffect(() => {
    if (!rowRef.current) return;
    if (prevStatusRef.current !== invocation.status) {
      if (isReducedMotion) {
        const el = rowRef.current;
        el.classList.add("bg-signal-500/8", "border-signal-500/25");
        setTimeout(() => {
          if (el) el.classList.remove("bg-signal-500/8", "border-signal-500/25");
        }, Math.max(motionTokens.controlFeedback.duration * 1000, 1));
      } else {
        gsap.killTweensOf(rowRef.current);
        gsap.fromTo(rowRef.current,
          { backgroundColor: "rgba(0, 224, 160, 0.08)", borderColor: "rgba(0, 224, 160, 0.25)" },
          { backgroundColor: "rgba(0, 0, 0, 0.015)", borderColor: "rgba(0, 0, 0, 0.04)", duration: motionTokens.controlFeedback.duration * 2, ease: motionTokens.controlFeedback.ease, overwrite: "auto", clearProps: "backgroundColor,borderColor" }
        );
      }
    }
    prevStatusRef.current = invocation.status;
  }, [invocation.status, isReducedMotion, motionTokens.controlFeedback.duration, motionTokens.controlFeedback.ease]);

  const activityAt = getInvocationActivityAt(invocation);
  const rawDuration = formatInvocationDuration(invocation.startedAt || invocation.createdAt, invocation.finishedAt);
  const durationStart = Date.parse(invocation.startedAt || invocation.createdAt);
  const durationEnd = invocation.finishedAt ? Date.parse(invocation.finishedAt) : Date.now();
  const duration = Number.isFinite(durationStart) && Number.isFinite(durationEnd) && durationEnd >= durationStart
    ? formatDuration(Math.round((durationEnd - durationStart) / 1000), locale)
    : rawDuration;
  const tokenTotal = invocation.totalTokens ?? ((invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0));
  const dotClass = INVOCATION_STATUS_DOT[invocation.status] || "bg-slate-400";
  const providerLabel = invocation.provider || t("providerPending");
  const modelLabel = invocation.model || t("modelPending");

  const purposeKey = INVOCATION_PURPOSE_KEYS[invocation.type ?? ""];
  const purposeLabel = purposeKey ? t(purposeKey) : formatInvocationPurpose(invocation.type);
  const statusKey = INVOCATION_STATUS_KEYS[invocation.status];
  const statusLabel = locale === "en" ? invocation.status : statusKey ? t(statusKey) : invocation.status;

  return (
    <div ref={rowRef} className={`group/row rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(invocation.status)}`}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dotClass} ${invocation.status === "running" ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
            <span className="sr-only">{t("invocationStatus", { status: statusLabel })}</span>
            {statusChanged && (
              <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {t("feedInvocationStatusChanged", {
                  previous: locale === "en" ? prevStatus : INVOCATION_STATUS_KEYS[prevStatus] ? t(INVOCATION_STATUS_KEYS[prevStatus]!) : prevStatus,
                  status: statusLabel,
                })}
              </span>
            )}
            <span className="min-w-0 break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
              {purposeLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span className="break-words">{providerLabel}</span>
            <span>·</span>
            <span className="break-words">{modelLabel}</span>
            <span>·</span>
            <span>{shortenRuntimeId(invocation.id)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(invocation.status)}`}>
            {statusLabel}
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400">
            {formatTime(new Date(activityAt))}
          </div>
          <a
            href={buildInvocationHref(invocation.id)}
            aria-label={t("openTranscript", { purpose: purposeLabel, id: shortenRuntimeId(invocation.id) ?? invocation.id })}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-signal-400 dark:focus-visible:ring-offset-void-800"
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {t("transcript")}
          </a>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <InvocationContextChips invocation={invocation} sprintKeyPrefix={sprintKeyPrefix} />
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
      </div>

      {invocation.lastErrorMessage && (
        <p role="alert" className="mt-2 line-clamp-2 break-words text-[11px] leading-relaxed text-status-red">
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
  const { t, tp, formatNumber } = useLiveI18n();
  const { execution: snapshot, snapshotSurface } = useExecutionTimeline();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const isReducedMotion = useReducedMotion();
  const motionTokens = useGsapInteractionTokens();

  useLayoutEffect(() => {
    if (!contentRef.current || !collapsible) return;
    if (isReducedMotion) {
      gsap.set(contentRef.current, { height: open ? "auto" : 0, overflow: "hidden" });
    } else {
      gsap.killTweensOf(contentRef.current);
      gsap.to(contentRef.current, {
        height: open ? "auto" : 0,
        duration: motionTokens.expansionCollapse.duration,
        ease: motionTokens.expansionCollapse.ease,
        overwrite: "auto",
        onComplete: () => {
          if (open && contentRef.current) gsap.set(contentRef.current, { height: "auto" });
        }
      });
    }
  }, [open, isReducedMotion, motionTokens.expansionCollapse.duration, motionTokens.expansionCollapse.ease, collapsible]);

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
  const newCount = useMemo(
    () => invocations.filter((invocation) => invocation.status !== "running" && invocation.status !== "completed" && invocation.status !== "failed").length,
    [invocations],
  );
  const invocationSummary = t("invocationSummary", {
    total: formatNumber(invocations.length),
    queued: formatNumber(newCount),
    running: formatNumber(runningCount),
    completed: formatNumber(completedCount),
    failed: formatNumber(failedCount),
  });
  const containerBuildProgress = useMemo(
    () => findLatestContainerBuildProgressFromInvocations(invocations)
      ?? findLatestContainerBuildProgressFromEvents(snapshot?.recentEvents),
    [invocations, snapshot?.recentEvents],
  );

  if (!snapshot) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 text-[11px] font-mono text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-500">
        {t("loadingInvocationFeed")}
      </div>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2.5">
      <Cpu className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("invocationFeed")}</span>
      <span className="rounded-md bg-black/[0.03] px-2 py-0.5 text-[9px] font-mono font-bold text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
        {t("totalCount", { count: formatNumber(invocations.length) })}
      </span>
      <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
        {t("liveCount", { count: formatNumber(runningCount) })}
      </span>
      <span className="rounded-md bg-status-green/10 px-2 py-0.5 text-[9px] font-mono font-bold text-status-green">
        {t("doneCount", { count: formatNumber(completedCount) })}
      </span>
      <span className="rounded-md bg-status-red/10 px-2 py-0.5 text-[9px] font-mono font-bold text-status-red">
        {t("failedCount", { count: formatNumber(failedCount) })}
      </span>
      <RuntimeSnapshotSurfaceBadge surface={snapshotSurface} />
      <span className="sr-only">{invocationSummary}</span>
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
          className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-[var(--interaction-control-feedback-duration)] hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
        >
          {header}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--interaction-expansion-collapse-duration)] ease-[var(--interaction-expansion-collapse-ease)] ${open ? "rotate-0" : "-rotate-90"}`}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="relative z-10 flex items-center justify-between gap-4 p-5">
          {header}
        </div>
      )}

      <div
        className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}
        id={contentId}
        aria-hidden={collapsible && !open ? "true" : undefined}
      >
        <div ref={contentRef} className={collapsible ? "collapsible-content overflow-hidden" : ""}>
          <div className="relative z-10 space-y-3 px-5 pb-5 pt-0">
            <RuntimeSnapshotSurfaceNotice surface={snapshotSurface} panelLabel={t("invocationFeed")} />
            <ContainerBuildStatusInfobox progress={containerBuildProgress} className="mb-3" />
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[
                { label: t("running"), value: runningCount, tone: "text-signal-500" },
                { label: t("done"), value: completedCount, tone: "text-status-green" },
                { label: t("failed"), value: failedCount, tone: "text-status-red" },
              ].map(({ label, value, tone }) => (
                <div key={label} className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30">
                  <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${tone}`}>{label}</div>
                  <div className={`mt-1 font-mono text-base font-semibold leading-none ${tone}`}>{formatNumber(value)}</div>
                </div>
              ))}
            </div>

            {invocations.length === 0 ? (
              <p role="status" aria-live="polite" className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                {t("noInvocationRecords")}
              </p>
            ) : (
              <>
                <p role={failedCount > 0 ? "alert" : "status"} aria-live={failedCount > 0 ? "assertive" : "polite"} aria-atomic="true" className="mb-2 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  {failedCount > 0
                    ? tp("invocationFailedCount", failedCount, { count: formatNumber(failedCount) })
                    : runningCount > 0
                      ? tp("invocationRunningCount", runningCount, { count: formatNumber(runningCount) })
                      : t("invocationFeedCurrent")}
                </p>
                <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                  {invocationSummary}
                </p>
                <div
                  role="log"
                  aria-label={t("liveInvocationFeed")}
                  aria-live="polite"
                  aria-busy={snapshotSurface?.isBusy || runningCount > 0 ? "true" : undefined}
                  aria-relevant="additions text"
                  className="max-h-[50dvh] sm:max-h-96 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar"
                >
                  {invocations.map((invocation) => (
                    <InvocationFeedRow
                      key={invocation.id}
                      invocation={invocation}
                      sprintKeyPrefix={sprintKeyPrefix}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
