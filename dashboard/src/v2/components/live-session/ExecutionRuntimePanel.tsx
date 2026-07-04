import type { ComponentChildren, FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { Radio, Bot, CheckCircle2, XCircle, Workflow, ChevronDown, Play, PauseCircle, Clock, RotateCcw } from "lucide-preact";
import { formatTime } from "../../../lib/time.js";
import { renderMarkdown } from "../../../lib/markdown.js";


import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { QuotaCountdown, TaskDuration } from "../LiveTaskCard.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { findActiveConcurrencyWait } from "../../../lib/task-progress.js";
import {
    getLiveActionDisplayProps,
    getLiveActionLabel,
    getLiveActionStatusLabel,
    getPendingActionState,
    type LiveActionLabels,
    type LiveActionState,
} from "../../lib/live-session-runtime.js";

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
    mixed: "Mixed",
};

const CONNECTION_ROLE_LABELS: Record<string, string> = {
    listener: "Listener",
    worker: "Worker",
    project_manager: "Manager",
};

function getInterventionHeading(intervention: { attentionType: string | null; ownerType: string | null }): string {
    if (intervention.attentionType === "merge_conflict") return "Merge conflict";
    if (intervention.ownerType === "system" || intervention.ownerType === "worker") return "Stopped automatically";
    return "Human intervention needed";
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

const RuntimeActionButton: FunctionComponent<{
    actionState: LiveActionState;
    labels: LiveActionLabels;
    ariaLabel: string;
    toneClassName: string;
    onActivate: () => void;
    icon: ComponentChildren;
}> = ({ actionState, labels, ariaLabel, toneClassName, onActivate, icon }) => {
    const label = getLiveActionLabel(actionState, labels);
    const statusLabel = getLiveActionStatusLabel(actionState, labels);
    const isPending = actionState === "pending";
    const isUnavailable = isPending || actionState === "disabled";

    return (
        <button
            type="button"
            onClick={() => {
                if (!isUnavailable) onActivate();
            }}
            aria-label={ariaLabel}
            title={statusLabel ?? label}
            {...getLiveActionDisplayProps(actionState, actionState === "disabled")}
            className={`inline-flex min-h-6 items-center gap-1.5 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors aria-disabled:opacity-60 ${toneClassName}`}
        >
            {icon}
            <span>{label}</span>
            {statusLabel && <span className="sr-only">{statusLabel}</span>}
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
    const { execution: snapshot } = useExecutionTimeline();
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
                Loading live connections.
            </div>
        );
    }

    const header = (
        <div className="flex flex-wrap items-center gap-2.5">
            <Radio className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Live Connections</span>
            <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    active {activeConnections.length}
                </span>
                <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-signal-500">
                    listening {listeningConnections.length}
                </span>
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    workers {workerConnections.length}
                </span>
                <span className="rounded-full border border-black/[0.05] bg-black/[0.03] px-2 py-1 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                    manager {managerConnections.length}
                </span>
            </div>
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
                        className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--interaction-enter-exit-duration)] ${open ? "rotate-0" : "-rotate-90"}`}
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
                    <div className={`relative z-10 ${collapsible ? "px-5 pb-5 pt-0" : "px-5 pb-5 pt-0"}`}>
                        {snapshot.connections.length === 0 ? (
                            <p role="status" aria-live="polite" className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                                No listeners or workers are connected to the selected project yet.
                            </p>
                        ) : (
                            <div className="max-h-[50dvh] sm:max-h-72 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar" role="log" aria-live="polite" aria-label="Live connection runtime rows">
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
                                                        {CONNECTION_ROLE_LABELS[connection.role] || connection.role}
                                                    </span>
                                                    {connection.listenMode && (
                                                        <span className="rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">
                                                            Listening
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
                                                    {connection.lastHeartbeatAt ? formatTime(connection.lastHeartbeatAt) : "no heartbeat"}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                inbox {connection.pendingInboxCount}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                dispatch {connection.activeDispatchCount}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                threads {connection.threadCount}
                                            </span>
                                            <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                runs {connection.tasksRunCount}
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

    if (!snapshot) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 text-[11px] font-mono text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-500">
                Loading execution runtime.
            </div>
        );
    }
    const activeSprintRuns = useMemo(() => snapshot.sprintRuns.filter((run) => run.status === "running" || run.status === "queued"), [snapshot.sprintRuns, snapshot.sprintRuns.length]);
    const activeDispatches = useMemo(() => snapshot.taskDispatches.filter((dispatch) => (
        dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running"
    )), [snapshot.taskDispatches, snapshot.taskDispatches.length]);
    const activeConnections = useMemo(() => snapshot.connections.filter((connection) => connection.status !== "offline"), [snapshot.connections, snapshot.connections.length]);
    const pendingInboxTotal = useMemo(
        () => snapshot.connections.reduce((sum, connection) => sum + connection.pendingInboxCount, 0),
        [snapshot.connections, snapshot.connections.length],
    );

    const { queuedWorkers, runningWorkers } = useMemo(() => {
        const workers = activeDispatches.filter((dispatch) => dispatch.executorType === "docker_cli");
        return {
            queuedWorkers: workers.filter((dispatch) => dispatch.status === "queued").length,
            runningWorkers: workers.filter((dispatch) => dispatch.status === "claimed" || dispatch.status === "running").length,
        };
    }, [activeDispatches]);

    const visibleSprintRuns = useMemo(() => snapshot.sprintRuns.slice(0, 4), [snapshot.sprintRuns, snapshot.sprintRuns.length]);
    const visibleTaskDispatches = useMemo(() => snapshot.taskDispatches.slice(0, 8), [snapshot.taskDispatches, snapshot.taskDispatches.length]);
    const blockedAttentionCount = useMemo(
        () => snapshot.attentionItems.filter((item) => item.status === "open" || item.status === "claimed").length,
        [snapshot.attentionItems, snapshot.attentionItems.length],
    );
    const failedTaskCount = useMemo(
        () => snapshot.taskDispatches.filter((dispatch) => dispatch.status === "failed").length,
        [snapshot.taskDispatches, snapshot.taskDispatches.length],
    );

    return (
        <div role="region" aria-label="Execution runtime" aria-busy={activeSprintRuns.length > 0 || activeDispatches.length > 0 ? "true" : undefined} className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-void-800">



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
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Execution Runtime</span>
                        <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                            {activeSprintRuns.length > 0 && (
                                <span className="rounded-md bg-signal-500/10 px-2 py-0.5 font-mono text-signal-500">
                                    active {activeSprintRuns.length}
                                </span>
                            )}
                            {blockedAttentionCount > 0 && (
                                <span className="rounded-md bg-status-amber/10 px-2 py-0.5 font-mono text-status-amber">
                                    attention {blockedAttentionCount}
                                </span>
                            )}
                            {failedTaskCount > 0 && (
                                <span className="rounded-md bg-status-red/10 px-2 py-0.5 font-mono text-status-red">
                                    failed {failedTaskCount}
                                </span>
                            )}
                        </div>
                    </div>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--interaction-enter-exit-duration)] ${open ? "rotate-0" : "-rotate-90"}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 px-6 pt-6">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Execution Runtime</span>
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
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {[
                                { label: "Active Runs", value: activeSprintRuns.length, accent: "text-signal-500" },
                                { label: "Active Dispatches", value: activeDispatches.length, accent: "text-slate-700 dark:text-slate-200" },
                                { label: "Worker Queued", value: queuedWorkers, accent: "text-ember-500" },
                                { label: "Worker Running", value: runningWorkers, accent: "text-status-green" },
                                { label: "Connections", value: activeConnections.length, accent: "text-signal-500" },
                                { label: "Pending Inbox", value: pendingInboxTotal, accent: "text-status-amber" },
                            ].map(({ label, value, accent }) => (
                                <div
                                    key={label}
                                    className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30"
                                >
                                    <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>{label}</div>
                                    <div className={`mt-1 font-mono text-lg font-black leading-none ${accent}`}>{value}</div>
                                </div>
                            ))}
                        </div>

                        <section aria-label="Sprint runs">
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/[0.04] pb-2 dark:border-white/[0.05]">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Sprint Runs</span>
                                <span className="rounded-md border border-black/[0.05] bg-black/[0.02] px-2 py-0.5 text-[9px] font-mono text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.025]">{snapshot.sprintRuns.length} total</span>
                            </div>
                            {snapshot.sprintRuns.length === 0 ? (
                                <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 text-[11px] font-mono text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.015] dark:text-slate-500">No sprint runs recorded for the selected project.</div>
                            ) : (
                                <div className="space-y-2" role="log" aria-live="polite" aria-label="Sprint run status rows">
                                    {visibleSprintRuns.map((run) => {
                                        const startActionState = getPendingActionState(pendingActionIds, `sprint-start:${run.sprintId}`);
                                        const pauseActionState = getPendingActionState(pendingActionIds, `sprint-pause:${run.id}`);
                                        const cancelActionState = getPendingActionState(pendingActionIds, `sprint-cancel:${run.id}`);
                                        const forceCancelActionState = getPendingActionState(pendingActionIds, `sprint-force-cancel:${run.id}`);
                                        const startIdleLabel = run.status === "paused" ? "Resume" : "Run Again";
                                        return (
                                        <div key={run.id} className={`rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${statusRailTone(run.status)}`}>
                                            <div className="flex items-center justify-between gap-3 min-w-0">
                                                <div className="min-w-0">
                                                    <div className="break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {run.sprintName}{run.sprintNumber != null ? ` · Sprint ${run.sprintNumber}` : ""}
                                                    </div>
                                                    <div className="mt-1 break-words text-[10px] font-mono text-slate-400">
                                                        {EXECUTOR_LABELS[run.executorMode] || run.executorMode} · {run.triggerType}
                                                        {run.triggeredBy ? ` · ${run.triggeredBy}` : ""}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(run.status)}`}>
                                                        {run.status}
                                                    </div>
                                                    {run.activeLeaseOwnerKey && (
                                                        <div className="mt-1 text-[10px] font-mono text-slate-400">
                                                            lease <span className="break-all">{run.activeLeaseOwnerKey}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(run.status === "paused" || run.status === "failed" || run.status === "completed" || run.status === "cancelled") && (
                                                    <RuntimeActionButton
                                                        actionState={startActionState}
                                                        labels={{ idle: startIdleLabel, pending: run.status === "paused" ? "Resuming" : "Starting", success: "Started", error: "Start Failed" }}
                                                        ariaLabel={`${run.status === "paused" ? "Resume" : "Run again"} sprint ${run.sprintName}`}
                                                        onActivate={() => onOrchestrateSprint(run.projectId, run.sprintId)}
                                                        toneClassName="border border-signal-500/20 bg-signal-500/10 text-signal-600 hover:bg-signal-500/15 dark:text-signal-400"
                                                        icon={<Play className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {(run.status === "running" || run.status === "queued") && (
                                                    <RuntimeActionButton
                                                        actionState={pauseActionState}
                                                        labels={{ idle: "Pause", pending: "Pausing", success: "Paused", error: "Pause Failed" }}
                                                        ariaLabel={`Pause sprint run ${run.sprintName}`}
                                                        onActivate={() => onPauseSprintRun(run.id)}
                                                        toneClassName="border border-status-amber/20 bg-status-amber/10 text-status-amber hover:bg-status-amber/15"
                                                        icon={<PauseCircle className={`h-3 w-3 ${pauseActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {(run.status === "running" || run.status === "queued" || run.status === "paused") && (
                                                    <RuntimeActionButton
                                                        actionState={cancelActionState}
                                                        labels={{ idle: "Cancel", pending: "Cancelling", success: "Cancel Requested", error: "Cancel Failed" }}
                                                        ariaLabel={`Cancel sprint run ${run.sprintName}`}
                                                        onActivate={() => onCancelSprintRun(run.id)}
                                                        toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                        icon={<XCircle className={`h-3 w-3 ${cancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {run.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-md border border-status-amber/20 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                                                            Stop Pending
                                                        </div>
                                                        <RuntimeActionButton
                                                            actionState={forceCancelActionState}
                                                            labels={{ idle: "Force Cancel", pending: "Force Cancelling", success: "Force Cancelled", error: "Force Cancel Failed" }}
                                                            ariaLabel={`Force cancel sprint run ${run.sprintName}`}
                                                            onActivate={() => onForceCancelSprintRun(run.id)}
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
                                                                {getInterventionHeading(run.humanIntervention)}
                                                            </div>
                                                            <div className="mt-1 break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                                {run.humanIntervention.title}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                                            <HumanInterventionBadge summary={run.humanIntervention} label="Details" compact align="right" />
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
                                                                Instructions
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

                        <section aria-label="Dispatch queue">
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/[0.04] pb-2 dark:border-white/[0.05]">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Dispatch Queue</span>
                                <span className="rounded-md border border-black/[0.05] bg-black/[0.02] px-2 py-0.5 text-[9px] font-mono text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.025]">{snapshot.taskDispatches.length} total</span>
                            </div>
                            {snapshot.taskDispatches.length === 0 ? (
                                <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 text-[11px] font-mono text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.015] dark:text-slate-500">No task dispatches yet.</div>
                            ) : (
                                <div className="max-h-[50dvh] sm:max-h-80 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar" role="log" aria-live="polite" aria-label="Task dispatch status rows">
                                    {visibleTaskDispatches.map((dispatch) => {
                                        const dispatchEvents = snapshot.recentEvents.filter(
                                            (e) => e.dispatchId === dispatch.id || (e.taskRunId && e.taskRunId === dispatch.taskRunId)
                                        );
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
                                                            <span>{EXECUTOR_LABELS[dispatch.executorType] || dispatch.executorType}</span>
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
                                                            {activeCap ? `Waiting for slot (${activeCap.currentCount}/${activeCap.limit})` : dispatch.status}
                                                        </div>
                                                        {dispatch.taskRunState && !activeCap && (
                                                            <div className={`mt-1 text-[10px] font-mono ${statusTone(dispatch.taskRunState)}`}>
                                                                {dispatch.taskRunState}
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
                                                        {dispatch.sessionId && <div className="break-all">session {dispatch.sessionId}</div>}
                                                        {dispatch.workerBranch && <div className="break-all">branch {dispatch.workerBranch}</div>}
                                                        {dispatch.activeLeaseOwnerKey && <div className="break-all">lease {dispatch.activeLeaseOwnerKey}</div>}
                                                        {dispatch.errorMessage && <QuotaCountdown errorMessage={dispatch.errorMessage} />}
                                                    </div>
                                                )}
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running") && (
                                                    <RuntimeActionButton
                                                        actionState={cancelActionState}
                                                        labels={{ idle: "Cancel", pending: "Cancelling", success: "Cancel Requested", error: "Cancel Failed" }}
                                                        ariaLabel={"Cancel dispatch " + dispatch.id}
                                                        onActivate={() => onCancelTaskDispatch(dispatch.id)}
                                                        toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                        icon={<XCircle className={`h-3 w-3 ${cancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                    />
                                                )}
                                                {dispatch.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-md border border-status-amber/20 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                                                            Stop Pending
                                                        </div>
                                                        <RuntimeActionButton
                                                            actionState={forceCancelActionState}
                                                            labels={{ idle: "Force Cancel", pending: "Force Cancelling", success: "Force Cancelled", error: "Force Cancel Failed" }}
                                                            ariaLabel={"Force cancel dispatch " + dispatch.id}
                                                            onActivate={() => onForceCancelTaskDispatch(dispatch.id)}
                                                            toneClassName="border border-status-red/20 bg-status-red/10 text-status-red hover:bg-status-red/15"
                                                            icon={<XCircle className={`h-3 w-3 ${forceCancelActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />}
                                                        />
                                                    </>
                                                )}
                                                {(dispatch.status === "failed" || dispatch.status === "blocked" || dispatch.status === "cancelled") && (
                                                    <RuntimeActionButton
                                                        actionState={retryActionState}
                                                        labels={{ idle: "Retry", pending: "Retrying", success: "Retry Started", error: "Retry Failed" }}
                                                        ariaLabel={"Retry dispatch " + dispatch.id}
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
