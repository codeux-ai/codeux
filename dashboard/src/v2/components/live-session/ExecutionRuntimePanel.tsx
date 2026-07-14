import type { ComponentChildren, FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { Radio, Bot, CheckCircle2, XCircle, Workflow, ChevronDown, Play, PauseCircle, Clock, RotateCcw } from "lucide-preact";
import { renderMarkdown } from "../../../lib/markdown.js";


import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { QuotaCountdown, TaskDuration } from "../LiveTaskCard.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import type { ExecutionSnapshotSurfaceState } from "../../../hooks/ExecutionTimelineContext.js";
import { findLatestContainerBuildProgressFromEvents, findLatestContainerBuildProgressFromInvocations } from "../../../lib/activity.js";
import { findActiveConcurrencyWait } from "../../../lib/task-progress.js";
import {
    getLiveActionDisplayProps,
    getLiveActionDisabledReason,
    getLiveActionLabel,
    getLiveActionStatusLabel,
    getPendingActionState,
    type LiveActionLabels,
    type LiveActionState,
} from "../../lib/live-session-runtime.js";
import { deriveExecutionRuntimeViewModel } from "../../lib/live-session/execution-runtime-view-model.js";
import { ContainerBuildStatusInfobox } from "./ContainerBuildStatusInfobox.js";
import { useLiveI18n, type LiveMessageKey } from "../../i18n/messages/live.js";

export const statusTone = (value: string | null): string => {
    if (!value) return "text-slate-400";
    const n = value.toUpperCase();
    if (n === "SUCCESS" || n === "COMPLETED" || n === "MERGED") return "text-status-green";
    if (n === "CANCEL_REQUESTED") return "text-status-amber";
    if (n === "IN_PROGRESS" || n === "QUEUED" || n === "PENDING" || n === "QUOTA") return "text-status-amber";
    if (n === "FAILURE" || n === "FAILED" || n === "ERROR" || n === "CANCELLED") return "text-status-red";
    if (n === "LISTENING") return "text-signal-500";
    if (n === "ONLINE") return "text-status-green";
    return "text-slate-400";
};

export const statusRailTone = (value: string | null): string => {
    if (!value) return "border-l-slate-400";
    const n = value.toUpperCase();
    if (n === "SUCCESS" || n === "COMPLETED" || n === "MERGED" || n === "ONLINE") return "border-l-status-green";
    if (n === "RUNNING" || n === "CLAIMED" || n === "LISTENING") return "border-l-signal-500";
    if (n === "IN_PROGRESS" || n === "QUEUED" || n === "PENDING" || n === "QUOTA" || n === "PAUSED" || n === "CANCEL_REQUESTED") return "border-l-status-amber";
    if (n === "FAILURE" || n === "FAILED" || n === "ERROR" || n === "CANCELLED" || n === "BLOCKED") return "border-l-status-red";
    return "border-l-slate-400";
};

const EXECUTOR_LABELS: Record<string, string> = {
    docker_cli: "CLI",
    jules: "Jules",
};

function getExecutorLabel(value: string, t: (key: LiveMessageKey) => string): string {
    return value === "mixed" ? t("mixed") : EXECUTOR_LABELS[value] || value;
}

const RUNTIME_STATUS_MESSAGE_KEYS: Readonly<Record<string, LiveMessageKey>> = {
    queued: "queued",
    claimed: "claimed",
    running: "running",
    paused: "paused",
    cancel_requested: "cancelRequested",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
    blocked: "blocked",
    quota: "quota",
    pending: "pending",
};

function getRuntimeStatusLabel(value: string, t: (key: LiveMessageKey) => string): string {
    const messageKey = RUNTIME_STATUS_MESSAGE_KEYS[value.toLowerCase()];
    return messageKey ? t(messageKey) : value;
}

function getInterventionHeading(
    intervention: { attentionType: string | null; ownerType: string | null },
    t: (key: LiveMessageKey) => string,
): string {
    if (intervention.attentionType === "merge_conflict") return t("mergeConflict");
    if (intervention.ownerType === "system" || intervention.ownerType === "worker") return t("stoppedAutomatically");
    return t("humanInterventionNeeded");
}

export const ATTENTION_SEVERITY_TONE: Record<string, string> = {
    critical: "border-status-red/20 bg-status-red/10 text-status-red",
    high: "border-status-red/20 bg-status-red/10 text-status-red",
    medium: "border-status-amber/20 bg-status-amber/10 text-status-amber",
    low: "border-signal-500/20 bg-signal-500/10 text-signal-500",
};

export const ATTENTION_OWNER_LABELS: Record<string, string> = {
    worker: "Worker",
    human: "Human",
    system: "System",
};

export const ATTENTION_TYPE_LABELS: Record<string, string> = {
    worker_lease_expired: "Worker Lease Expired",
    worker_dispatch_blocked: "Worker Dispatch Blocked",
    dispatch_cancel_stalled: "Dispatch Cancel Stalled",
    merge_required: "Merge Required",
    merge_conflict: "Merge Conflict",
    action_required: "Action Required",
    manual_attention: "Manual Attention",
};

export const ATTENTION_STATUS_TONE: Record<string, string> = {
    open: "text-status-amber",
    claimed: "text-signal-500",
    resolved: "text-status-green",
    dismissed: "text-slate-400",
    expired: "text-slate-400",
};

export const shortenRuntimeId = (value: string | null | undefined): string | null => (
    value ? value.slice(0, 8) : null
);

const DEFAULT_RUNTIME_SNAPSHOT_SURFACE: ExecutionSnapshotSurfaceState = {
    kind: "live",
    label: "Live",
    description: "Runtime data is current.",
    isBusy: false,
};

export const RuntimeSnapshotSurfaceBadge: FunctionComponent<{
    surface?: ExecutionSnapshotSurfaceState;
}> = ({ surface = DEFAULT_RUNTIME_SNAPSHOT_SURFACE }) => {
    if (surface.kind === "live") {
        return null;
    }
    const toneClass = surface.kind === "stale"
        ? "border-status-amber/20 bg-status-amber/10 text-status-amber"
        : "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300";

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${toneClass}`}
            title={surface.description}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-current motion-reduce:ring-2 motion-reduce:ring-current/25" aria-hidden="true" />
            {surface.label}
            <span className="sr-only">. {surface.description}</span>
        </span>
    );
};

export const RuntimeSnapshotSurfaceNotice: FunctionComponent<{
    surface?: ExecutionSnapshotSurfaceState;
    panelLabel: string;
}> = ({ surface = DEFAULT_RUNTIME_SNAPSHOT_SURFACE, panelLabel }) => {
    const { t } = useLiveI18n();
    if (surface.kind === "live") {
        return null;
    }

    const toneClass = surface.kind === "stale"
        ? "border-status-amber/20 bg-status-amber/[0.055] text-status-amber"
        : "border-signal-500/20 bg-signal-500/[0.055] text-signal-700 dark:text-signal-300";
    const message = t(surface.kind === "stale" ? "panelCachedSnapshot" : "panelRefreshingSnapshot", { panel: panelLabel });

    return (
        <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`rounded-r-xl rounded-l-sm border border-l-2 px-3 py-2 text-[10px] font-mono leading-relaxed ${toneClass}`}
        >
            <span className="font-bold uppercase tracking-[0.14em]">{surface.label}</span>
            <span className="mx-1" aria-hidden="true">/</span>
            {message}
        </p>
    );
};

const RuntimeActionButton: FunctionComponent<{
    actionState: LiveActionState;
    labels: LiveActionLabels;
    ariaLabel: string;
    toneClassName: string;
    onActivate: () => void;
    icon: ComponentChildren;
    disabledReason?: string | null;
}> = ({ actionState, labels, ariaLabel, toneClassName, onActivate, icon, disabledReason = null }) => {
    const { locale, t } = useLiveI18n();
    const statusId = useId();
    const reasonId = useId();
    const label = getLiveActionLabel(actionState, labels, locale);
    const statusLabel = getLiveActionStatusLabel(actionState, labels, locale);
    const unavailableReason = getLiveActionDisabledReason(actionState, labels, disabledReason, locale);
    const isPending = actionState === "pending";
    const isUnavailable = isPending || actionState === "disabled";
    const accessibleLabel = isUnavailable
        ? `${ariaLabel}. ${unavailableReason ?? statusLabel ?? t("actionUnavailable")}`
        : ariaLabel;
    const describedBy = [
        statusLabel ? statusId : null,
        unavailableReason ? reasonId : null,
    ].filter(Boolean).join(" ") || undefined;

    return (
        <button
            type="button"
            onClick={(event) => {
                if (isUnavailable) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                onActivate();
            }}
            aria-label={accessibleLabel}
            aria-describedby={describedBy}
            title={unavailableReason ?? statusLabel ?? label}
            {...getLiveActionDisplayProps(actionState, actionState === "disabled", disabledReason)}
            className={`inline-flex min-h-6 items-center gap-1.5 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors aria-disabled:opacity-60 ${toneClassName}`}
        >
            {icon}
            <span>{label}</span>
            {statusLabel && (
                <span
                    id={statusId}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="text-[8px] normal-case tracking-normal opacity-80"
                >
                    {statusLabel}
                </span>
            )}
            {unavailableReason && unavailableReason !== statusLabel && (
                <span id={reasonId} className={actionState === "disabled" ? "text-[8px] normal-case tracking-normal opacity-80" : "sr-only"}>{unavailableReason}</span>
            )}
        </button>
    );
};

export const ConnectionRuntimePanel: FunctionComponent<{
    collapsible?: boolean;
    defaultOpen?: boolean;
}> = memo(({
    collapsible = false,
    defaultOpen = true,
}) => {
    const { locale, t, formatNumber, formatTime } = useLiveI18n();
    const { execution: snapshot, snapshotSurface = DEFAULT_RUNTIME_SNAPSHOT_SURFACE } = useExecutionTimeline();
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

    const { activeConnections, listeningConnections, workerConnections, managerConnections } = useMemo(() => {
        const active = snapshot?.connections.filter((connection) => connection.status !== "offline") ?? [];
        return {
            activeConnections: active,
            listeningConnections: active.filter((connection) => connection.listenMode || connection.role === "listener"),
            workerConnections: active.filter((connection) => connection.role === "worker"),
            managerConnections: active.filter((connection) => connection.role === "project_manager"),
        };
    }, [snapshot?.connections, snapshot?.connections?.length]);

    const visibleConnections = useMemo(
        () => (snapshot?.connections ?? []).slice(0, 8),
        [snapshot?.connections, snapshot?.connections?.length],
    );

    if (!snapshot) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 text-[11px] font-mono text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-500">
                {t("loadingLiveConnections")}
            </div>
        );
    }

    const header = (
        <div className="flex flex-wrap items-center gap-2.5">
            <Radio className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("liveConnections")}</span>
            <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    {t("active").toLocaleLowerCase(locale)} {formatNumber(activeConnections.length)}
                </span>
                <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-signal-500">
                    {t("listening").toLocaleLowerCase(locale)} {formatNumber(listeningConnections.length)}
                </span>
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    {t("workers").toLocaleLowerCase(locale)} {formatNumber(workerConnections.length)}
                </span>
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    {t("manager").toLocaleLowerCase(locale)} {formatNumber(managerConnections.length)}
                </span>
            </div>
            <RuntimeSnapshotSurfaceBadge surface={snapshotSurface} />
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
                    <div className={`relative z-10 flex flex-col gap-3 ${collapsible ? "px-5 pb-5 pt-0" : "px-5 pb-5 pt-0"}`}>
                        <RuntimeSnapshotSurfaceNotice surface={snapshotSurface} panelLabel={t("liveConnections")} />
                        {snapshot.connections.length === 0 ? (
                            <p role="status" aria-live="polite" className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                                {t("noConnections")}
                            </p>
                        ) : (
                            <div className="max-h-[50dvh] sm:max-h-72 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar" role="log" aria-live="polite" aria-busy={snapshotSurface.isBusy ? "true" : undefined} aria-label={t("liveConnectionRuntimeRows")}>
                                {visibleConnections.map((connection) => (
                                    <div
                                        key={connection.id}
                                        className={`rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(connection.status)}`}
                                    >
                                        <div className="flex items-start justify-between gap-3 min-w-0">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="min-w-0 break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {connection.displayName}
                                                    </span>
                                                    <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                        {connection.role === "listener" ? t("listener") : connection.role === "worker" ? t("worker") : connection.role === "project_manager" ? t("manager") : connection.role}
                                                    </span>
                                                    {connection.listenMode && (
                                                        <span className="rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">
                                                            {t("listening")}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                    <span>{connection.transport}</span>
                                                    {connection.model && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="break-words">{connection.model}</span>
                                                        </>
                                                    )}
                                                    <span>·</span>
                                                    <span className="break-all">{connection.connectionKey}</span>
                                                </div>
                                                {(connection.machineName || connection.platform || connection.arch || connection.localExecutionRuntime) && (
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                        {connection.machineName && <span className="break-all">{connection.machineName}</span>}
                                                        {connection.platform && (
                                                            <>
                                                                <span>·</span>
                                                                <span>{connection.platform}</span>
                                                            </>
                                                        )}
                                                        {connection.arch && (
                                                            <>
                                                                <span>·</span>
                                                                <span>{connection.arch}</span>
                                                            </>
                                                        )}
                                                        {connection.localExecutionRuntime && (
                                                            <>
                                                                <span>·</span>
                                                                <span>{connection.localExecutionRuntime}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(connection.status)}`}>
                                                    {connection.status}
                                                </div>
                                                <div className="mt-1 text-[10px] font-mono text-slate-400">
                                                    {connection.lastHeartbeatAt ? formatTime(new Date(connection.lastHeartbeatAt)) : t("noHeartbeat")}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {t("inboxCount", { count: formatNumber(connection.pendingInboxCount) })}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {t("dispatchCount", { count: formatNumber(connection.activeDispatchCount) })}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {t("threadsCount", { count: formatNumber(connection.threadCount) })}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {t("runsCount", { count: formatNumber(connection.tasksRunCount) })}
                                            </span>
                                        </div>

                                        {(connection.labels.length > 0 || connection.instruction) && (
                                            <div className="mt-3 border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
                                                {connection.labels.length > 0 && (
                                                    <div className="mb-2 flex flex-wrap gap-2">
                                                        {connection.labels.slice(0, 4).map((label) => (
                                                            <span
                                                                key={label}
                                                                className="rounded-md border border-ember-500/20 bg-ember-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ember-500"
                                                            >
                                                                {label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {connection.instruction && (
                                                    <p className="line-clamp-2 break-words text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                                        {connection.instruction}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});



export const ExecutionRuntimePanel: FunctionComponent<{
    collapsible?: boolean;
    defaultOpen?: boolean;
}> = memo(({
    collapsible = false,
    defaultOpen = true,
}) => {
    const { t, formatNumber } = useLiveI18n();
    const {
        execution: snapshot,
        onOrchestrateSprint,
        onPauseSprintRun,
        onCancelSprintRun,
        onForceCancelSprintRun,
        onCancelTaskDispatch,
        onForceCancelTaskDispatch,
        onRetryTaskDispatch,
        pendingActionIds,
        snapshotSurface = DEFAULT_RUNTIME_SNAPSHOT_SURFACE,
    } = useExecutionTimeline();

    const [open, setOpen] = useState(defaultOpen);
    const [expandedInterventionIds, setExpandedInterventionIds] = useState<Set<string>>(() => new Set());
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

    const runtimeViewModel = useMemo(
        () => snapshot ? deriveExecutionRuntimeViewModel(snapshot) : null,
        [
            snapshot?.sprintRuns,
            snapshot?.taskDispatches,
            snapshot?.connections,
            snapshot?.attentionItems,
            snapshot?.recentEvents,
        ],
    );
    const containerBuildProgress = useMemo(
        () => findLatestContainerBuildProgressFromEvents(snapshot?.recentEvents)
            ?? findLatestContainerBuildProgressFromInvocations(snapshot?.recentInvocations),
        [snapshot?.recentEvents, snapshot?.recentInvocations],
    );

    if (!snapshot) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 text-[11px] font-mono text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-500">
                {t("executionRuntime")}
            </div>
        );
    }

    const {
        activeSprintRuns,
        activeDispatches,
        activeConnections,
        pendingInboxTotal,
        queuedWorkers,
        runningWorkers,
        visibleSprintRuns,
        visibleTaskDispatches,
        blockedAttentionCount,
        failedTaskCount,
        dispatchEventsByDispatchId,
        runtimeSummary,
    } = runtimeViewModel!;

    return (
        <div role="region" aria-label={t("executionRuntimeAria")} aria-busy={snapshotSurface.isBusy || activeSprintRuns.length > 0 || activeDispatches.length > 0 ? "true" : undefined} className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-void-800">



            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={() => setOpen((current) => !current)}
                    className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-[var(--interaction-control-feedback-duration)] hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
                >
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("executionRuntime")}</span>
                        <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                            <span className="rounded-md bg-signal-500/10 px-2 py-0.5 font-mono text-signal-500">
                                {t("activeCount", { count: formatNumber(activeSprintRuns.length) })}
                            </span>
                            <span className="rounded-md bg-black/[0.03] px-2 py-0.5 font-mono text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
                                {t("dispatchCount", { count: formatNumber(activeDispatches.length) })}
                            </span>
                            <span className="rounded-md bg-status-amber/10 px-2 py-0.5 font-mono text-status-amber">
                                {t("attentionCount", { count: formatNumber(blockedAttentionCount) })}
                            </span>
                            <span className="rounded-md bg-status-red/10 px-2 py-0.5 font-mono text-status-red">
                                {t("failedCount", { count: formatNumber(failedTaskCount) })}
                            </span>
                        </div>
                        <RuntimeSnapshotSurfaceBadge surface={snapshotSurface} />
                        <span className="sr-only">{runtimeSummary}</span>
                    </div>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--interaction-expansion-collapse-duration)] ease-[var(--interaction-expansion-collapse-ease)] ${open ? "rotate-0" : "-rotate-90"}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 px-6 pt-6">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("executionRuntime")}</span>
                    </div>
                </div>
            )}

            <div
                className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}
                id={contentId}
                aria-hidden={collapsible && !open ? "true" : undefined}
            >
                <div ref={contentRef} className={collapsible ? "collapsible-content overflow-hidden" : ""}>
                    <div className={`relative z-10 space-y-5 ${collapsible ? "px-5 pb-5 pt-0" : "px-5 pb-5 pt-0"}`}>
                        <RuntimeSnapshotSurfaceNotice surface={snapshotSurface} panelLabel={t("executionRuntime")} />
                        <ContainerBuildStatusInfobox progress={containerBuildProgress} />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {[
                                { label: t("activeRuns"), value: activeSprintRuns.length, accent: "text-signal-500" },
                                { label: t("activeDispatches"), value: activeDispatches.length, accent: "text-slate-700 dark:text-slate-200" },
                                { label: t("workerQueued"), value: queuedWorkers, accent: "text-ember-500" },
                                { label: t("workerRunning"), value: runningWorkers, accent: "text-status-green" },
                                { label: t("connections"), value: activeConnections.length, accent: "text-signal-500" },
                                { label: t("pendingInbox"), value: pendingInboxTotal, accent: "text-status-amber" },
                            ].map(({ label, value, accent }) => (
                                <div
                                    key={label}
                                    className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30"
                                >
                                    <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>{label}</div>
                                    <div className={`mt-1 font-mono text-base font-semibold leading-none ${accent}`}>{formatNumber(value)}</div>
                                </div>
                            ))}
                        </div>

                        <section aria-label={t("sprintRunsAria")}>
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/[0.04] pb-2 dark:border-white/[0.05]">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("sprintRuns")}</span>
                                <span className="rounded-md border border-black/[0.05] bg-black/[0.02] px-2 py-0.5 text-[9px] font-mono text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.025]">{t("totalCount", { count: formatNumber(snapshot.sprintRuns.length) })}</span>
                            </div>
                            {snapshot.sprintRuns.length === 0 ? (
                                <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 text-[11px] font-mono text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.015] dark:text-slate-500">{t("noSprintRuns")}</div>
                            ) : (
                                <div className="space-y-2" role="log" aria-live="polite" aria-busy={snapshotSurface.isBusy ? "true" : undefined} aria-label={t("sprintRunStatusRows")}>
                                    {visibleSprintRuns.map((run) => {
                                        const startActionState = getPendingActionState(pendingActionIds, `sprint-start:${run.sprintId}`);
                                        const pauseActionState = getPendingActionState(pendingActionIds, `sprint-pause:${run.id}`);
                                        const cancelActionState = getPendingActionState(pendingActionIds, `sprint-cancel:${run.id}`);
                                        const forceCancelActionState = getPendingActionState(pendingActionIds, `sprint-force-cancel:${run.id}`);
                                        const startIdleLabel = t(run.status === "paused" ? "resume" : "startAgain");
                                        return (
                                        <div key={run.id} className={`rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(run.status)}`}>
                                            <div className="flex items-center justify-between gap-3 min-w-0">
                                                <div className="min-w-0">
                                                    <div className="break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {run.sprintName}{run.sprintNumber != null ? ` · ${t("sprintNumber", { number: formatNumber(run.sprintNumber) })}` : ""}
                                                    </div>
                                                    <div className="mt-1 break-words text-[10px] font-mono text-slate-400">
                                                        {getExecutorLabel(run.executorMode, t)} · {run.triggerType}
                                                        {run.triggeredBy ? ` · ${run.triggeredBy}` : ""}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(run.status)}`}>
                                                        {getRuntimeStatusLabel(run.status, t)}
                                                    </div>
                                                    {run.activeLeaseOwnerKey && (
                                                        <div className="mt-1 text-[10px] font-mono text-slate-400">
                                                            {t("lease")} <span className="break-all">{run.activeLeaseOwnerKey}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(run.status === "paused" || run.status === "failed" || run.status === "completed" || run.status === "cancelled") && (
                                                    <RuntimeActionButton
                                                        actionState={startActionState}
                                                        labels={{ idle: startIdleLabel, pending: t(run.status === "paused" ? "resuming" : "starting"), success: t("started"), error: t("startFailed") }}
                                                        ariaLabel={t(run.status === "paused" ? "resumeSprintAria" : "runAgainSprintAria", { sprint: run.sprintName })}
                                                        onActivate={() => onOrchestrateSprint(run.projectId, run.sprintId)}
                                                        toneClassName="border border-signal-500/20 bg-signal-500/10 text-signal-600 hover:bg-signal-500/15 dark:text-signal-400"
                                                        icon={<Play className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {(run.status === "running" || run.status === "queued") && (
                                                    <RuntimeActionButton
                                                        actionState={pauseActionState}
                                                        labels={{ idle: t("pause"), pending: t("pausing"), success: t("paused"), error: t("pauseFailed") }}
                                                        ariaLabel={t("pauseSprintAria", { sprint: run.sprintName })}
                                                        onActivate={() => onPauseSprintRun(run.id)}
                                                        toneClassName="border border-status-amber/20 bg-status-amber/10 text-status-amber hover:bg-status-amber/15"
                                                        icon={<PauseCircle className={`h-3 w-3 ${pauseActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {(run.status === "running" || run.status === "queued" || run.status === "paused") && (
                                                    <RuntimeActionButton
                                                        actionState={cancelActionState}
                                                        labels={{ idle: t("cancel"), pending: t("cancelling"), success: t("cancelRequested"), error: t("cancelFailed") }}
                                                        ariaLabel={t("cancelSprintAria", { sprint: run.sprintName })}
                                                        onActivate={() => onCancelSprintRun(run.id, run.sprintName)}
                                                        toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                        icon={<XCircle className={`h-3 w-3 ${cancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {run.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-md border border-status-amber/20 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                                                            {t("stopPending")}
                                                        </div>
                                                        <RuntimeActionButton
                                                            actionState={forceCancelActionState}
                                                            labels={{ idle: t("forceCancel"), pending: t("forceCancelling"), success: t("forceCancelled"), error: t("forceCancelFailed") }}
                                                            ariaLabel={t("forceCancelSprintAria", { sprint: run.sprintName })}
                                                            onActivate={() => onForceCancelSprintRun(run.id, run.sprintName)}
                                                            toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                            icon={<XCircle className={`h-3 w-3 ${forceCancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                        />
                                                    </>
                                                )}
                                            </div>
                                            {run.humanIntervention && (
                                                <div className={`mt-3 rounded-xl border ${
                                                    run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker"
                                                        ? "border-slate-400/18 bg-slate-400/8"
                                                        : "border-status-amber/18 bg-status-amber/8"
                                                } p-3`}>
                                                    <div className="flex items-start justify-between gap-3 min-w-0">
                                                        <div className="min-w-0">
                                                            <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
                                                                run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker"
                                                                    ? "text-slate-500 dark:text-slate-400"
                                                                    : "text-status-amber"
                                                            }`}>
                                                                {getInterventionHeading(run.humanIntervention, t)}
                                                            </div>
                                                            <div className="mt-1 break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                                {run.humanIntervention.title}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                                            <HumanInterventionBadge summary={run.humanIntervention} label={t("details")} compact align="right" />
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedInterventionIds((current) => {
                                                                    const next = new Set(current);
                                                                    if (next.has(run.id)) {
                                                                        next.delete(run.id);
                                                                    } else {
                                                                        next.add(run.id);
                                                                    }
                                                                    return next;
                                                                })}
                                                                aria-expanded={expandedInterventionIds.has(run.id)}
                                                                aria-controls={`${contentId}-intervention-${run.id}`}
                                                                className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/60 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:border-signal-500/25 hover:text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-slate-200"
                                                            >
                                                                {t("instructions")}
                                                                <ChevronDown
                                                                    className={`h-3 w-3 transition-transform ${expandedInterventionIds.has(run.id) ? "rotate-180" : ""}`}
                                                                    strokeWidth={2}
                                                                    aria-hidden="true"
                                                                />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {expandedInterventionIds.has(run.id) && (
                                                        <div id={`${contentId}-intervention-${run.id}`} className="mt-3 rounded-lg border border-black/[0.04] bg-white/45 p-3 dark:border-white/[0.05] dark:bg-white/[0.025]">
                                                            <p className="break-words text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                                                                {run.humanIntervention.reason}
                                                            </p>
                                                            <p className="mt-2 break-words text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                                                            {run.humanIntervention.instructions}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        <section aria-label={t("dispatchQueueAria")}>
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/[0.04] pb-2 dark:border-white/[0.05]">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("dispatchQueue")}</span>
                                <span className="rounded-md border border-black/[0.05] bg-black/[0.02] px-2 py-0.5 text-[9px] font-mono text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.025]">{t("totalCount", { count: formatNumber(snapshot.taskDispatches.length) })}</span>
                            </div>
                            {snapshot.taskDispatches.length === 0 ? (
                                <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 text-[11px] font-mono text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.015] dark:text-slate-500">{t("noDispatches")}</div>
                            ) : (
                                <div className="max-h-[50dvh] sm:max-h-80 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar" role="log" aria-live="polite" aria-busy={snapshotSurface.isBusy ? "true" : undefined} aria-label={t("taskDispatchStatusRows")}>
                                    {visibleTaskDispatches.map((dispatch) => {
                                        const dispatchEvents = dispatchEventsByDispatchId.get(dispatch.id) ?? [];
                                        const activeCap = findActiveConcurrencyWait(dispatchEvents, dispatch.status);
                                        const cancelActionState = getPendingActionState(pendingActionIds, `dispatch-cancel:${dispatch.id}`);
                                        const forceCancelActionState = getPendingActionState(pendingActionIds, `dispatch-force-cancel:${dispatch.id}`);
                                        const retryActionState = getPendingActionState(pendingActionIds, `dispatch-retry:${dispatch.id}`);
                                        return (
                                            <div key={dispatch.id} className={`rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(activeCap ? "PENDING" : dispatch.status)}`}>
                                                <div className="flex items-start justify-between gap-3 min-w-0">
                                                    <div className="min-w-0">
                                                        <div className="break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            {dispatch.taskKey} · {dispatch.taskTitle}
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                            <span className="break-words">{dispatch.sprintName}</span>
                                                            <span>·</span>
                                                            <span>{getExecutorLabel(dispatch.executorType, t)}</span>
                                                            {dispatch.connectionDisplayName && (
                                                                <>
                                                                    <span>·</span>
                                                                    <span className="inline-flex min-w-0 items-center gap-1 break-words">
                                                                        <Bot className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                                                                        {dispatch.connectionDisplayName}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(activeCap ? "PENDING" : dispatch.status)}`}>
                                                            {activeCap ? t("waitingForSlot", { current: formatNumber(activeCap.currentCount), limit: formatNumber(activeCap.limit) }) : getRuntimeStatusLabel(dispatch.status, t)}
                                                        </div>
                                                        {dispatch.taskRunState && !activeCap && (
                                                            <div className={`mt-1 text-[10px] font-mono ${statusTone(dispatch.taskRunState)}`}>
                                                                {getRuntimeStatusLabel(dispatch.taskRunState, t)}
                                                            </div>
                                                        )}
                                                        <TaskDuration
                                                            dispatchTiming={{
                                                                startedAt: dispatch.startedAt,
                                                                finishedAt: dispatch.finishedAt,
                                                                status: dispatch.status,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                {(dispatch.sessionId || dispatch.workerBranch || dispatch.errorMessage || dispatch.activeLeaseOwnerKey) && (
                                                    <div className="mt-2 space-y-1 border-t border-black/[0.04] pt-2 text-[10px] font-mono text-slate-400 dark:border-white/[0.04]">
                                                        {dispatch.sessionId && <div className="break-all">{t("session")} {dispatch.sessionId}</div>}
                                                        {dispatch.workerBranch && <div className="break-all">{t("branch")} {dispatch.workerBranch}</div>}
                                                        {dispatch.activeLeaseOwnerKey && <div className="break-all">{t("lease")} {dispatch.activeLeaseOwnerKey}</div>}
                                                        {dispatch.errorMessage && <QuotaCountdown errorMessage={dispatch.errorMessage} />}
                                                    </div>
                                                )}
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running") && (
                                                    <RuntimeActionButton
                                                        actionState={cancelActionState}
                                                        labels={{ idle: t("cancel"), pending: t("cancelling"), success: t("cancelRequested"), error: t("cancelFailed") }}
                                                        ariaLabel={t("cancelDispatchAria", { task: `${dispatch.taskKey}: ${dispatch.taskTitle}` })}
                                                        onActivate={() => onCancelTaskDispatch(dispatch.id, `${dispatch.taskKey}: ${dispatch.taskTitle}`)}
                                                        toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                        icon={<XCircle className={`h-3 w-3 ${cancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {dispatch.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-md border border-status-amber/20 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                                                            {t("stopPending")}
                                                        </div>
                                                        <RuntimeActionButton
                                                            actionState={forceCancelActionState}
                                                            labels={{ idle: t("forceCancel"), pending: t("forceCancelling"), success: t("forceCancelled"), error: t("forceCancelFailed") }}
                                                            ariaLabel={t("forceCancelDispatchAria", { task: `${dispatch.taskKey}: ${dispatch.taskTitle}` })}
                                                            onActivate={() => onForceCancelTaskDispatch(dispatch.id, `${dispatch.taskKey}: ${dispatch.taskTitle}`)}
                                                            toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                            icon={<XCircle className={`h-3 w-3 ${forceCancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                        />
                                                    </>
                                                )}
                                                {(dispatch.status === "failed" || dispatch.status === "blocked" || dispatch.status === "cancelled") && (
                                                    <RuntimeActionButton
                                                        actionState={retryActionState}
                                                        labels={{ idle: t("retry"), pending: t("retrying"), success: t("retryStarted"), error: t("retryFailed") }}
                                                        ariaLabel={t("retryDispatchAria", { task: `${dispatch.taskKey}: ${dispatch.taskTitle}` })}
                                                        onActivate={() => onRetryTaskDispatch(dispatch.id)}
                                                        toneClassName="border border-signal-500/20 bg-signal-500/10 text-signal-600 hover:bg-signal-500/15 dark:text-signal-400"
                                                        icon={<RotateCcw className={`h-3 w-3 ${retryActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
});
