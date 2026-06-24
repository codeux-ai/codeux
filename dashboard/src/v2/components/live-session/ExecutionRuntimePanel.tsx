import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState } from "preact/hooks";
import { Radio, Bot, CheckCircle2, XCircle, Workflow, ChevronDown, Play, PauseCircle, Clock, RotateCcw } from "lucide-preact";
import { formatTime } from "../../../lib/time.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { QuotaCountdown, TaskDuration } from "../LiveTaskCard.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { findActiveConcurrencyWait } from "../../../lib/task-progress.js";

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

    if (!snapshot) return null;

    const header = (
        <div className="flex flex-wrap items-center gap-2.5">
            <Radio className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
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
        <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#00E0A0" />
            <BorderTrace accentHex="#00E0A0" />

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
                    <div className={`relative z-10 ${collapsible ? "px-5 pb-5 pt-0" : "px-5 pb-5 pt-0"}`}>
                        {snapshot.connections.length === 0 ? (
                            <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                                No listeners or workers are connected to the selected project yet.
                            </p>
                        ) : (
                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar">
                                {visibleConnections.map((connection) => (
                                    <div
                                        key={connection.id}
                                        className="rounded-xl border border-black/[0.04] bg-white/55 p-3 dark:border-white/[0.04] dark:bg-void-900/30"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {connection.displayName}
                                                    </span>
                                                    <span className="rounded-full border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                        {CONNECTION_ROLE_LABELS[connection.role] || connection.role}
                                                    </span>
                                                    {connection.listenMode && (
                                                        <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">
                                                            Listening
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                    <span>{connection.transport}</span>
                                                    {connection.model && (
                                                        <>
                                                            <span>·</span>
                                                            <span>{connection.model}</span>
                                                        </>
                                                    )}
                                                    <span>·</span>
                                                    <span className="truncate">{connection.connectionKey}</span>
                                                </div>
                                                {(connection.machineName || connection.platform || connection.arch || connection.localExecutionRuntime) && (
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                        {connection.machineName && <span>{connection.machineName}</span>}
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
                                            <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                inbox {connection.pendingInboxCount}
                                            </span>
                                            <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                dispatch {connection.activeDispatchCount}
                                            </span>
                                            <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                threads {connection.threadCount}
                                            </span>
                                            <span className="rounded-full border border-black/[0.05] px-2 py-1 text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
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
                                                                className="rounded-full border border-ember-500/20 bg-ember-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ember-500"
                                                            >
                                                                {label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {connection.instruction && (
                                                    <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
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
    if (!snapshot) return null;
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

    return (
        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#00E0A0" />
            <BorderTrace accentHex="#00E0A0" />

            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls="execution-runtime-panel-content"
                    onClick={() => setOpen((current) => !current)}
                    className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-200 hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
                >
                    <div className="flex items-center gap-2.5">
                        <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Execution Runtime</span>
                        {activeSprintRuns.length > 0 && (
                            <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
                                {activeSprintRuns.length} active
                            </span>
                        )}
                    </div>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
                        strokeWidth={2}
                    />
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 px-7 pt-7">
                    <div className="flex items-center gap-2.5">
                        <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Execution Runtime</span>
                        {activeSprintRuns.length > 0 && (
                            <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
                                {activeSprintRuns.length} active
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div
                className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}
                id="execution-runtime-panel-content"
            >
                <div className={collapsible ? "collapsible-content" : ""}>
                    <div className={`relative z-10 space-y-7 ${collapsible ? "px-5 pb-5 pt-0" : "px-7 pb-7 pt-4"}`}>
                        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
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
                                    className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.35)] dark:border-white/[0.06] dark:bg-void-900/30 dark:shadow-none"
                                >
                                    <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>{label}</div>
                                    <div className={`mt-1 font-mono text-xl font-black leading-none tracking-tighter ${accent}`}>{value}</div>
                                </div>
                            ))}
                        </div>

                        <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Sprint Runs</span>
                                <span className="text-[9px] font-mono text-slate-400">{snapshot.sprintRuns.length} total</span>
                            </div>
                            {snapshot.sprintRuns.length === 0 ? (
                                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">No sprint runs recorded for the selected project.</p>
                            ) : (
                                <div className="space-y-2">
                                    {visibleSprintRuns.map((run) => (
                                        <div key={run.id} className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {run.sprintName}{run.sprintNumber != null ? ` · Sprint ${run.sprintNumber}` : ""}
                                                    </div>
                                                    <div className="mt-1 text-[10px] font-mono text-slate-400">
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
                                                            lease {run.activeLeaseOwnerKey}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(run.status === "paused" || run.status === "failed" || run.status === "completed" || run.status === "cancelled") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onOrchestrateSprint(run.projectId, run.sprintId)}
                                                        disabled={pendingActionIds.has(`sprint-start:${run.sprintId}`)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                                    >
                                                        <Play className="h-3 w-3" strokeWidth={2} />
                                                        {pendingActionIds.has(`sprint-start:${run.sprintId}`) ? "Starting" : (run.status === "paused" ? "Resume" : "Run Again")}
                                                    </button>
                                                )}
                                                {(run.status === "running" || run.status === "queued") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onPauseSprintRun(run.id)}
                                                        disabled={pendingActionIds.has(`sprint-pause:${run.id}`)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber transition-colors hover:bg-status-amber/15 disabled:opacity-50"
                                                    >
                                                        <PauseCircle className={`h-3 w-3 ${pendingActionIds.has(`sprint-pause:${run.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                        {pendingActionIds.has(`sprint-pause:${run.id}`) ? "Pausing" : "Pause"}
                                                    </button>
                                                )}
                                                {(run.status === "running" || run.status === "queued" || run.status === "paused") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onCancelSprintRun(run.id)}
                                                        disabled={pendingActionIds.has(`sprint-cancel:${run.id}`)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                    >
                                                        <XCircle className={`h-3 w-3 ${pendingActionIds.has(`sprint-cancel:${run.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                        {pendingActionIds.has(`sprint-cancel:${run.id}`) ? "Cancelling" : "Cancel"}
                                                    </button>
                                                )}
                                                {run.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} />
                                                            Stop Pending
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => onForceCancelSprintRun(run.id)}
                                                            disabled={pendingActionIds.has(`sprint-force-cancel:${run.id}`)}
                                                            className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                        >
                                                            <XCircle className={`h-3 w-3 ${pendingActionIds.has(`sprint-force-cancel:${run.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                            {pendingActionIds.has(`sprint-force-cancel:${run.id}`) ? "Force Cancelling" : "Force Cancel"}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            {run.humanIntervention && (
                                                <div className={`mt-3 rounded-xl border ${
                                                    run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker"
                                                        ? "border-slate-400/18 bg-slate-400/8"
                                                        : "border-status-amber/18 bg-status-amber/8"
                                                } p-3`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
                                                                run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker"
                                                                    ? "text-slate-500 dark:text-slate-400"
                                                                    : "text-status-amber"
                                                            }`}>
                                                                {run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker"
                                                                    ? "Stopped automatically"
                                                                    : "Human intervention needed"}
                                                            </div>
                                                            <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                                {run.humanIntervention.title}
                                                            </div>
                                                        </div>
                                                        <HumanInterventionBadge summary={run.humanIntervention} label="Details" compact align="right" />
                                                    </div>
                                                    <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                                                        {run.humanIntervention.reason}
                                                    </p>
                                                    {!(run.humanIntervention.ownerType === "system" || run.humanIntervention.ownerType === "worker") && (
                                                        <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                                                            {run.humanIntervention.instructions}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Dispatch Queue</span>
                                <span className="text-[9px] font-mono text-slate-400">{snapshot.taskDispatches.length} total</span>
                            </div>
                            {snapshot.taskDispatches.length === 0 ? (
                                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">No task dispatches yet.</p>
                            ) : (
                                <div className="max-h-72 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar">
                                    {visibleTaskDispatches.map((dispatch) => {
                                        const dispatchEvents = snapshot.recentEvents.filter(
                                            (e) => e.dispatchId === dispatch.id || (e.taskRunId && e.taskRunId === dispatch.taskRunId)
                                        );
                                        const activeCap = findActiveConcurrencyWait(dispatchEvents, dispatch.status);
                                        return (
                                            <div key={dispatch.id} className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            {dispatch.taskKey} · {dispatch.taskTitle}
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                                            <span>{dispatch.sprintName}</span>
                                                            <span>·</span>
                                                            <span>{EXECUTOR_LABELS[dispatch.executorType] || dispatch.executorType}</span>
                                                            {dispatch.connectionDisplayName && (
                                                                <>
                                                                    <span>·</span>
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <Bot className="h-3 w-3" strokeWidth={2} />
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
                                                        {dispatch.sessionId && <div>session {dispatch.sessionId}</div>}
                                                        {dispatch.workerBranch && <div>branch {dispatch.workerBranch}</div>}
                                                        {dispatch.activeLeaseOwnerKey && <div>lease {dispatch.activeLeaseOwnerKey}</div>}
                                                        {dispatch.errorMessage && <QuotaCountdown errorMessage={dispatch.errorMessage} />}
                                                    </div>
                                                )}
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onCancelTaskDispatch(dispatch.id)}
                                                        disabled={pendingActionIds.has(`dispatch-cancel:${dispatch.id}`)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                    >
                                                        <XCircle className={`h-3 w-3 ${pendingActionIds.has(`dispatch-cancel:${dispatch.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                        {pendingActionIds.has(`dispatch-cancel:${dispatch.id}`) ? "Cancelling" : "Cancel"}
                                                    </button>
                                                )}
                                                {dispatch.status === "cancel_requested" && (
                                                    <>
                                                        <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                                                            <Clock className="h-3 w-3" strokeWidth={2} />
                                                            Stop Pending
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => onForceCancelTaskDispatch(dispatch.id)}
                                                            disabled={pendingActionIds.has(`dispatch-force-cancel:${dispatch.id}`)}
                                                            className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                        >
                                                            <XCircle className={`h-3 w-3 ${pendingActionIds.has(`dispatch-force-cancel:${dispatch.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                            {pendingActionIds.has(`dispatch-force-cancel:${dispatch.id}`) ? "Force Cancelling" : "Force Cancel"}
                                                        </button>
                                                    </>
                                                )}
                                                {(dispatch.status === "failed" || dispatch.status === "blocked" || dispatch.status === "cancelled") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onRetryTaskDispatch(dispatch.id)}
                                                        disabled={pendingActionIds.has(`dispatch-retry:${dispatch.id}`)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                                    >
                                                        <RotateCcw className={`h-3 w-3 ${pendingActionIds.has(`dispatch-retry:${dispatch.id}`) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                        {pendingActionIds.has(`dispatch-retry:${dispatch.id}`) ? "Retrying" : "Retry"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
