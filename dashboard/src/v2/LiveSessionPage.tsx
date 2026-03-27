import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import {
    Zap, Clock, CheckCircle2, XCircle, AlertTriangle,
    Activity, ChevronDown, Radio,
    Play, RotateCcw, Bot, Workflow, PauseCircle,
    Ship, BarChart3,
} from "lucide-preact";
import { SprintStatsDeck, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { HumanInterventionBadge } from "./components/ui/HumanInterventionBadge.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { useSprints } from "../hooks/useSprints.js";
import { useLiveSessionActions } from "./hooks/use-live-session-actions.js";
import { formatTime } from "../lib/time.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask, ExecutionDashboardSnapshot, ExecutionRuntimeEventSummary } from "../types.js";
import { deriveLiveSessionRuntimeState, resolveLiveSessionSprintScopeId } from "./lib/live-session-runtime.js";
import { getTaskProgressPhase } from "../lib/task-progress.js";
import { computeStats } from "../lib/status.js";

import { IntelPanel } from "./components/ui/IntelPanel.js";
import { CollapsiblePanel } from "./components/ui/CollapsiblePanel.js";
import { ExecutionTimelineProvider, useExecutionTimeline } from "../hooks/ExecutionTimelineContext.js";
import { ExecutionTimeline } from "./components/ExecutionTimeline.js";
import { IdleRuntimeState } from "./components/ui/IdleRuntimeState.js";
import { SkeletonPanel } from "./components/ui/ListSkeletons.js";
import {
    EMPTY_RUNTIME_STATS,
} from "./lib/live-session-config.js";
import { LiveTaskCard, TaskDuration, QuotaCountdown } from "./components/LiveTaskCard.js";
import { RuntimeEventFeed } from "./components/RuntimeEventFeed.js";
import { GitCIStatusPanel } from "./components/GitCIStatusPanel.js";
import { deriveLiveDurationDisplay } from "./lib/live-duration-display.js";
import { useProjectData } from "./context/project-data.js";
import { useProjectTasks } from "./hooks/use-project-tasks.js";
import { buildLiveSessionTasks } from "./lib/live-session-task-structure.js";

const statusTone = (value: string | null): string => {
    if (!value) return "text-slate-400";
    const n = value.toUpperCase();
    if (n === "SUCCESS" || n === "COMPLETED" || n === "MERGED") return "text-status-green";
    if (n === "CANCEL_REQUESTED") return "text-status-amber";
    if (n === "IN_PROGRESS" || n === "QUEUED" || n === "PENDING" || n === "QUOTA") return "text-status-amber";
    if (n === "FAILURE" || n === "FAILED" || n === "ERROR" || n === "CANCELLED") return "text-status-red";
    return "text-slate-400";
};

const SprintBoatRace = lazy(() => import("./components/SprintBoatRace.js").then(m => ({ default: m.SprintBoatRace })));
const SprintDag = lazy(() => import("./components/SprintDag.js").then(m => ({ default: m.SprintDag })));

const EXECUTOR_LABELS: Record<string, string> = {
    docker_cli: "CLI",
    jules: "Jules",
    mcp_worker: "Worker",
    mixed: "Mixed",
};

const CONNECTION_ROLE_LABELS: Record<string, string> = {
    listener: "Listener",
    worker: "Worker",
    project_manager: "Manager",
};


const ATTENTION_SEVERITY_TONE: Record<string, string> = {
    critical: "border-status-red/20 bg-status-red/10 text-status-red",
    high: "border-status-red/20 bg-status-red/10 text-status-red",
    medium: "border-status-amber/20 bg-status-amber/10 text-status-amber",
    low: "border-signal-500/20 bg-signal-500/10 text-signal-500",
};

const ATTENTION_OWNER_LABELS: Record<string, string> = {
    worker: "Worker",
    human: "Human",
    system: "System",
};

const ATTENTION_TYPE_LABELS: Record<string, string> = {
    worker_lease_expired: "Worker Lease Expired",
    worker_dispatch_blocked: "Worker Dispatch Blocked",
    dispatch_cancel_stalled: "Dispatch Cancel Stalled",
    merge_required: "Merge Required",
    merge_conflict: "Merge Conflict",
    action_required: "Action Required",
    manual_attention: "Manual Attention",
};

const ATTENTION_STATUS_TONE: Record<string, string> = {
    open: "text-status-amber",
    claimed: "text-signal-500",
    resolved: "text-status-green",
    dismissed: "text-slate-400",
    expired: "text-slate-400",
};

const shortenRuntimeId = (value: string | null | undefined): string | null => (
    value ? value.slice(0, 8) : null
);

const ConnectionRuntimePanel: FunctionComponent<{
    snapshot: ExecutionDashboardSnapshot;
}> = ({ snapshot }) => {
    const activeConnections = snapshot.connections.filter((connection) => connection.status !== "offline");
    const listeningConnections = activeConnections.filter((connection) => connection.status === "listening");
    const workerConnections = activeConnections.filter((connection) => connection.role === "worker");

    return (
        <div className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-4 dark:border-white/[0.04] dark:bg-white/[0.015]">
            <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">Live Connections</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
                    <span>{activeConnections.length} active</span>
                    <span>{listeningConnections.length} listening</span>
                    <span>{workerConnections.length} workers</span>
                </div>
            </div>

            {snapshot.connections.length === 0 ? (
                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                    No listeners or workers are connected to the selected project yet.
                </p>
            ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto dashboard-scrollbar pr-1">
                    {snapshot.connections.slice(0, 8).map((connection) => (
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
                                        <span className="rounded-full border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                            {CONNECTION_ROLE_LABELS[connection.role] || connection.role}
                                        </span>
                                        {connection.listenMode && (
                                            <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-500">
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
                                    <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(connection.status)}`}>
                                        {connection.status}
                                    </div>
                                    <div className="mt-1 text-[10px] font-mono text-slate-400">
                                        {connection.lastHeartbeatAt ? formatTime(connection.lastHeartbeatAt) : "no heartbeat"}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.12em]">
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
                                                    className="rounded-full border border-ember-500/20 bg-ember-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-ember-500"
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
    );
};

const AttentionQueuePanel: FunctionComponent<{
    snapshot: ExecutionDashboardSnapshot;
    onClaimAttentionItem: (projectId: string, attentionItemId: string) => void;
    onResolveAttentionItem: (projectId: string, attentionItemId: string) => void;
    onDismissAttentionItem: (projectId: string, attentionItemId: string) => void;
    pendingActionIds: Set<string>;
}> = ({
    snapshot,
    onClaimAttentionItem,
    onResolveAttentionItem,
    onDismissAttentionItem,
    pendingActionIds,
}) => {
    const workersByEndpointId = useMemo(() => {
        const pairs = [
            snapshot.primaryAssignedWorker,
            ...snapshot.overflowAssignedWorkers,
        ].filter(Boolean).map((worker) => [worker!.workerEndpointId || "", worker!.workerDisplayName] as const);
        return new Map(pairs);
    }, [snapshot.overflowAssignedWorkers, snapshot.primaryAssignedWorker]);

    const openCount = snapshot.attentionItems.filter((item) => item.status === "open").length;
    const claimedCount = snapshot.attentionItems.filter((item) => item.status === "claimed").length;
    const canAutoClaim = Boolean(snapshot.primaryAssignedWorker || snapshot.overflowAssignedWorkers.length > 0);

    return (
        <div>
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block">Attention Queue</span>
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em]">
                    <span className="rounded-full border border-status-amber/20 bg-status-amber/10 px-2 py-1 text-status-amber">
                        open {openCount}
                    </span>
                    <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-signal-500">
                        claimed {claimedCount}
                    </span>
                </div>
            </div>

            {snapshot.attentionItems.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">
                    No active blockers are waiting in the project attention queue.
                </p>
            ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto dashboard-scrollbar pr-1">
                    {snapshot.attentionItems.slice(0, 8).map((item) => {
                        const assignedWorkerLabel = item.assignedWorkerEndpointId
                            ? workersByEndpointId.get(item.assignedWorkerEndpointId) || item.assignedWorkerEndpointId
                            : item.ownerType === "worker"
                                ? "Unassigned"
                                : ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType;
                        const canClaim = (
                            Boolean(snapshot.projectId)
                            && item.ownerType === "worker"
                            && item.status === "open"
                            && (Boolean(item.assignedWorkerEndpointId) || canAutoClaim)
                        );
                        const claimActionId = `attention-claim:${item.id}`;
                        const resolveActionId = `attention-resolve:${item.id}`;
                        const dismissActionId = `attention-dismiss:${item.id}`;

                        return (
                            <div
                                key={item.id}
                                className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.015] dark:bg-white/[0.015] p-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                {item.title}
                                            </span>
                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                                                ATTENTION_SEVERITY_TONE[item.severity] || ATTENTION_SEVERITY_TONE.medium
                                            }`}>
                                                {item.severity}
                                            </span>
                                            <span className="rounded-full border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {ATTENTION_TYPE_LABELS[item.attentionType] || item.attentionType.replace(/_/g, " ")}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                            <span className={ATTENTION_STATUS_TONE[item.status] || "text-slate-400"}>
                                                {item.status}
                                            </span>
                                            <span>·</span>
                                            <span>{ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType}</span>
                                            <span>·</span>
                                            <span>{assignedWorkerLabel}</span>
                                            {shortenRuntimeId(item.taskId) && (
                                                <>
                                                    <span>·</span>
                                                    <span>task {shortenRuntimeId(item.taskId)}</span>
                                                </>
                                            )}
                                            {shortenRuntimeId(item.dispatchId) && (
                                                <>
                                                    <span>·</span>
                                                    <span>dispatch {shortenRuntimeId(item.dispatchId)}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right text-[10px] font-mono text-slate-400">
                                        {formatTime(item.updatedAt)}
                                    </div>
                                </div>

                                <div
                                    className="mt-3 prose prose-sm max-w-none text-[11px] leading-relaxed text-slate-500 dark:text-slate-400
                                               prose-p:my-0 prose-code:text-signal-600 dark:prose-code:text-signal-400
                                               prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md line-clamp-3"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summaryMarkdown || "No summary provided.") }}
                                />

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {canClaim && snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onClaimAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(claimActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                        >
                                            <Bot className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(claimActionId) ? "Claiming" : "Claim"}
                                        </button>
                                    )}
                                    {snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onResolveAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(resolveActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-status-green/20 bg-status-green/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-green transition-colors hover:bg-status-green/15 disabled:opacity-50"
                                        >
                                            <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(resolveActionId) ? "Resolving" : "Resolve"}
                                        </button>
                                    )}
                                    {snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onDismissAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(dismissActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.05] disabled:opacity-50"
                                        >
                                            <XCircle className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(dismissActionId) ? "Dismissing" : "Dismiss"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const ExecutionRuntimePanel: FunctionComponent<{
    collapsible?: boolean;
    defaultOpen?: boolean;
}> = ({
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
        onClaimAttentionItem,
        onResolveAttentionItem,
        onDismissAttentionItem,
        pendingActionIds,
    } = useExecutionTimeline();

    const [open, setOpen] = useState(defaultOpen);
    if (!snapshot) return null;
    const activeSprintRuns = snapshot.sprintRuns.filter((run) => run.status === "running" || run.status === "queued");
    const activeDispatches = snapshot.taskDispatches.filter((dispatch) => (
        dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running"
    ));
    const activeConnections = snapshot.connections.filter((connection) => connection.status !== "offline");
    const workerDispatches = activeDispatches.filter((dispatch) => dispatch.executorType === "mcp_worker");
    const queuedWorkers = workerDispatches.filter((dispatch) => dispatch.status === "queued").length;
    const runningWorkers = workerDispatches.filter((dispatch) => dispatch.status === "claimed" || dispatch.status === "running").length;

    return (
        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#00E0A0" />
            <BorderTrace accentHex="#00E0A0" />

            {/* Header — clickable when collapsible */}
            {collapsible ? (
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    className="relative z-10 w-full flex items-center justify-between gap-4 p-5 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors duration-200"
                >
                    <div className="flex items-center gap-2.5">
                        <Workflow className="w-4 h-4 text-signal-500" strokeWidth={1.5} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Execution Runtime</span>
                        {activeSprintRuns.length > 0 && (
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-signal-500/10 text-signal-500">
                                {activeSprintRuns.length} active
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-slate-400">
                            {snapshot.updatedAt ? `Updated ${formatTime(snapshot.updatedAt)}` : "No active project"}
                        </span>
                        <ChevronDown
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
                            strokeWidth={2}
                        />
                    </div>
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 px-7 pt-7">
                    <div className="flex items-center gap-2.5">
                        <Workflow className="w-4 h-4 text-signal-500" strokeWidth={1.5} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Execution Runtime</span>
                    </div>
                    <span className="text-[9px] font-mono text-slate-400">
                        {snapshot.updatedAt ? `Updated ${formatTime(snapshot.updatedAt)}` : "No active project"}
                    </span>
                </div>
            )}

            <div className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}>
            <div className={collapsible ? "collapsible-content" : ""}>
            <div className={`relative z-10 space-y-6 ${collapsible ? "px-5 pb-5" : "px-7 pb-7 pt-4"}`}>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {[
                        { label: "Active Runs", value: activeSprintRuns.length, accent: "text-signal-500" },
                        { label: "Active Dispatches", value: activeDispatches.length, accent: "text-slate-700 dark:text-slate-200" },
                        { label: "Worker Queued", value: queuedWorkers, accent: "text-ember-500" },
                        { label: "Worker Running", value: runningWorkers, accent: "text-status-green" },
                        { label: "Connections", value: activeConnections.length, accent: "text-signal-500" },
                        { label: "Pending Inbox", value: snapshot.connections.reduce((sum, connection) => sum + connection.pendingInboxCount, 0), accent: "text-status-amber" },
                    ].map(({ label, value, accent }) => (
                        <div key={label} className="rounded-xl bg-black/[0.02] dark:bg-white/[0.02] p-3">
                            <div className={`text-xl font-black font-mono leading-none ${accent}`}>{value}</div>
                            <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</div>
                        </div>
                    ))}
                </div>

                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">Sprint Runs</span>
                    {snapshot.sprintRuns.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No sprint runs recorded for the selected project.</p>
                    ) : (
                        <div className="space-y-2">
                            {snapshot.sprintRuns.slice(0, 4).map((run) => (
                                <div key={run.id} className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.015] dark:bg-white/[0.015] p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                                                {run.sprintName}{run.sprintNumber != null ? ` · Sprint ${run.sprintNumber}` : ""}
                                            </div>
                                            <div className="mt-1 text-[10px] font-mono text-slate-400">
                                                {EXECUTOR_LABELS[run.executorMode] || run.executorMode} · {run.triggerType}
                                                {run.triggeredBy ? ` · ${run.triggeredBy}` : ""}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(run.status)}`}>
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
                                                className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                            >
                                                <Play className="w-3 h-3" strokeWidth={2} />
                                                {pendingActionIds.has(`sprint-start:${run.sprintId}`) ? "Starting" : (run.status === "paused" ? "Resume" : "Run Again")}
                                            </button>
                                        )}
                                        {(run.status === "running" || run.status === "queued") && (
                                            <button
                                                type="button"
                                                onClick={() => onPauseSprintRun(run.id)}
                                                disabled={pendingActionIds.has(`sprint-pause:${run.id}`)}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-amber transition-colors hover:bg-status-amber/15 disabled:opacity-50"
                                            >
                                                <PauseCircle className="w-3 h-3" strokeWidth={2} />
                                                {pendingActionIds.has(`sprint-pause:${run.id}`) ? "Pausing" : "Pause"}
                                            </button>
                                        )}
                                        {(run.status === "running" || run.status === "queued" || run.status === "paused") && (
                                            <button
                                                type="button"
                                                onClick={() => onCancelSprintRun(run.id)}
                                                disabled={pendingActionIds.has(`sprint-cancel:${run.id}`)}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                            >
                                                <XCircle className="w-3 h-3" strokeWidth={2} />
                                                {pendingActionIds.has(`sprint-cancel:${run.id}`) ? "Cancelling" : "Cancel"}
                                            </button>
                                        )}
                                        {run.status === "cancel_requested" && (
                                            <>
                                                <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                    <Clock className="w-3 h-3" strokeWidth={2} />
                                                    Stop Pending
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => onForceCancelSprintRun(run.id)}
                                                    disabled={pendingActionIds.has(`sprint-force-cancel:${run.id}`)}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                >
                                                    <XCircle className="w-3 h-3" strokeWidth={2} />
                                                    {pendingActionIds.has(`sprint-force-cancel:${run.id}`) ? "Force Cancelling" : "Force Cancel"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    {run.humanIntervention && (
                                        <div className="mt-3 rounded-xl border border-status-amber/18 bg-status-amber/8 p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                                                        Human intervention needed
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
                                            <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                                                {run.humanIntervention.instructions}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">Dispatch Queue</span>
                    {snapshot.taskDispatches.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No task dispatches yet.</p>
                    ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto dashboard-scrollbar pr-1">
                            {snapshot.taskDispatches.slice(0, 8).map((dispatch) => (
                                <div key={dispatch.id} className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.015] dark:bg-white/[0.015] p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
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
                                                            <Bot className="w-3 h-3" strokeWidth={2} />
                                                            {dispatch.connectionDisplayName}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(dispatch.status)}`}>
                                                {dispatch.status}
                                            </div>
                                            {dispatch.taskRunState && (
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
                                        <div className="mt-2 border-t border-black/[0.04] dark:border-white/[0.04] pt-2 text-[10px] font-mono text-slate-400 space-y-1">
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
                                                className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                            >
                                                <XCircle className="w-3 h-3" strokeWidth={2} />
                                                {pendingActionIds.has(`dispatch-cancel:${dispatch.id}`) ? "Cancelling" : "Cancel"}
                                            </button>
                                        )}
                                        {dispatch.status === "cancel_requested" && (
                                            <>
                                                <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-amber">
                                                    <Clock className="w-3 h-3" strokeWidth={2} />
                                                    Stop Pending
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => onForceCancelTaskDispatch(dispatch.id)}
                                                    disabled={pendingActionIds.has(`dispatch-force-cancel:${dispatch.id}`)}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-50"
                                                >
                                                    <XCircle className="w-3 h-3" strokeWidth={2} />
                                                    {pendingActionIds.has(`dispatch-force-cancel:${dispatch.id}`) ? "Force Cancelling" : "Force Cancel"}
                                                </button>
                                            </>
                                        )}
                                        {(dispatch.status === "failed" || dispatch.status === "blocked" || dispatch.status === "cancelled") && (
                                            <button
                                                type="button"
                                                onClick={() => onRetryTaskDispatch(dispatch.id)}
                                                disabled={pendingActionIds.has(`dispatch-retry:${dispatch.id}`)}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                            >
                                                <RotateCcw className={`w-3 h-3 ${pendingActionIds.has(`dispatch-retry:${dispatch.id}`) ? 'animate-spin' : ''}`} strokeWidth={2} />
                                                {pendingActionIds.has(`dispatch-retry:${dispatch.id}`) ? "Retrying" : "Retry"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <AttentionQueuePanel
                    snapshot={snapshot}
                    onClaimAttentionItem={onClaimAttentionItem}
                    onResolveAttentionItem={onResolveAttentionItem}
                    onDismissAttentionItem={onDismissAttentionItem}
                    pendingActionIds={pendingActionIds}
                />

                <ConnectionRuntimePanel snapshot={snapshot} />

                <ExecutionTimeline activeSprintRuns={activeSprintRuns} />
            </div>
            </div>
            </div>
        </div>
    );
};

/* ─── Header View Type ──────────────────────────────────────────────────── */

type HeaderView = "stats" | "race" | "dag";

/* ─── Filter Type ────────────────────────────────────────────────────────── */

type TaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

const FILTER_STATUS_MAP: Record<TaskFilter, string | null> = {
    All: null, Running: "RUNNING", Completed: "COMPLETED", Failed: "FAILED", Pending: "PENDING",
};

const TASK_FILTERS: TaskFilter[] = ["All", "Running", "Completed", "Failed", "Pending"];
const EMPTY_RUNTIME_EVENTS: ExecutionRuntimeEventSummary[] = [];
const EMPTY_LIVE_SESSION_RUNTIME_STATE = {
    liveSprintRun: null,
    pausedInterventionRun: null,
    hasActiveSprint: false,
    hasSprintContext: false,
} as const;

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export const LiveSessionPage: FunctionComponent = () => {
    const headerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const { projects, selectedProjectId } = useProjectData();
    const { error, execution, gitStatus, gitStatusError, initialLoadComplete: legacyInitialLoadComplete, refreshRuntimeStatus, refreshGitStatus, status, tasksWithLiveActivities } = useDashboardRuntimeData(selectedProjectId);
    const realtimeProjectId = selectedProjectId || execution.projectId || status.project_id || null;
    const { data: sprints, selectedSprintId, loading: sprintsLoading } = useSprints(realtimeProjectId);
    const sprintScopeId = useMemo(
        () => resolveLiveSessionSprintScopeId(status, selectedSprintId),
        [selectedSprintId, status],
    );
    const sprintScopeReady = Boolean(
        selectedSprintId
        || sprintScopeId
        || (legacyInitialLoadComplete && !sprintsLoading)
    );
    const { tasks: projectTasks } = useProjectTasks(
        realtimeProjectId,
        projects,
        sprints,
        sprintScopeReady ? sprintScopeId : undefined,
        { enabled: sprintScopeReady },
    );
    const initialLoadComplete = legacyInitialLoadComplete && !sprintsLoading;

    const {
        rerunningIds,
        pendingActionIds,
        handleRerun,
        handleOrchestrateSprint,
        handlePauseSprintRun,
        handleCancelSprintRun,
        handleForceCancelSprintRun,
        handleCancelTaskDispatch,
        handleForceCancelTaskDispatch,
        handleRetryTaskDispatch,
        handleClaimAttentionItem,
        handleResolveAttentionItem,
        handleDismissAttentionItem,
    } = useLiveSessionActions(refreshRuntimeStatus, refreshGitStatus);

    const [activeFilter, setFilter] = useState<TaskFilter>("All");
    const [headerView, setHeaderView] = useState<HeaderView>("dag");

    /* GSAP entrance */
    useLayoutEffect(() => {
        if (headerRef.current) {
            gsap.fromTo(
                Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
        if (contentRef.current) {
            gsap.fromTo(
                Array.from(contentRef.current.children),
                { opacity: 0, y: 50 },
                { opacity: 1, y: 0, stagger: 0.08, duration: 1, ease: "power4.out", delay: 0.2 },
            );
        }
    }, []);

    const runtimeState = useMemo(
        () => sprintScopeReady
            ? deriveLiveSessionRuntimeState(status, execution, sprintScopeId)
            : EMPTY_LIVE_SESSION_RUNTIME_STATE,
        [execution, sprintScopeId, sprintScopeReady, status],
    );
    const liveSprintRun = runtimeState.liveSprintRun;
    const pausedInterventionRun = runtimeState.pausedInterventionRun;
    const pausedIntervention = pausedInterventionRun?.humanIntervention || null;
    const hasLiveSprint = runtimeState.hasActiveSprint;

    const rawHasSprintContext = runtimeState.hasSprintContext;
    const sprintDispatches = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.taskDispatches.filter((d) => d.sprintId === sprintScopeId)
            : execution.taskDispatches;
    }, [execution.taskDispatches, sprintScopeId, sprintScopeReady]);

    const sprintEvents = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.recentEvents.filter((e) => e.sprintId === sprintScopeId)
            : execution.recentEvents;
    }, [execution.recentEvents, sprintScopeId, sprintScopeReady]);

    const sprintRuns = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.sprintRuns.filter((r) => r.sprintId === sprintScopeId)
            : execution.sprintRuns;
    }, [execution.sprintRuns, sprintScopeId, sprintScopeReady]);

    const visibleTasksWithLiveActivities = useMemo(
        () => buildLiveSessionTasks(
            projectTasks,
            tasksWithLiveActivities,
            realtimeProjectId,
            sprintDispatches,
            sprintEvents,
        ),
        [projectTasks, realtimeProjectId, sprintDispatches, sprintEvents, tasksWithLiveActivities],
    );

    const hasSprintContext = rawHasSprintContext || visibleTasksWithLiveActivities.length > 0;

    const [nowIso, setNowIso] = useState(() => new Date().toISOString());

    const visibleStats = useMemo(() => {
        if (!hasSprintContext) return EMPTY_RUNTIME_STATS;
        return computeStats(visibleTasksWithLiveActivities);
    }, [hasSprintContext, visibleTasksWithLiveActivities]);

    const { sprintTiming, taskTimings, taskTimingMap } = useLiveTaskTimingSummaries({
        tasks: visibleTasksWithLiveActivities,
        dispatches: sprintDispatches,
        events: sprintEvents,
        sprintRuns: sprintRuns,
        nowIso,
    });

    const hasLiveDurationTicker = useMemo(() => (
        taskTimings.some((taskTiming) => (
            deriveLiveDurationDisplay({ taskTiming }).mode === "live"
        ))
        || sprintDispatches.some((dispatch) => (
            deriveLiveDurationDisplay({
                dispatchTiming: {
                    startedAt: dispatch.startedAt,
                    finishedAt: dispatch.finishedAt,
                    status: dispatch.status,
                },
            }).mode === "live"
        ))
    ), [sprintDispatches, taskTimings]);

    useEffect(() => {
        setNowIso(new Date().toISOString());
        if (!hasLiveDurationTicker) {
            return;
        }
        const timer = window.setInterval(() => {
            setNowIso(new Date().toISOString());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [hasLiveDurationTicker]);

    const taskEventsByRecordId = useMemo(() => {
        const byRecordId = new Map<string, ExecutionRuntimeEventSummary[]>();
        const byTaskKey = new Map<string, ExecutionRuntimeEventSummary[]>();
        for (const event of sprintEvents) {
            if (event.taskId) {
                const existing = byRecordId.get(event.taskId) || [];
                existing.push(event);
                byRecordId.set(event.taskId, existing);
            }
            if (event.taskKey) {
                const existing = byTaskKey.get(event.taskKey) || [];
                existing.push(event);
                byTaskKey.set(event.taskKey, existing);
            }
        }
        return { byRecordId, byTaskKey };
    }, [sprintEvents]);

    const dispatchInfoByTaskId = useMemo(() => {
        const map = new Map<string, {
            errorMessage: string | null;
            startedAt: string | null;
            finishedAt: string | null;
            status: string | null;
        }>();
        for (const dispatch of sprintDispatches) {
            if (!dispatch.taskId) continue;
            const existing = map.get(dispatch.taskId);
            // Keep the most recent dispatch (last in list), but prefer one with error if present
            if (!existing || dispatch.errorMessage || (!existing.errorMessage && dispatch.startedAt)) {
                map.set(dispatch.taskId, {
                    errorMessage: dispatch.errorMessage,
                    startedAt: dispatch.startedAt,
                    finishedAt: dispatch.finishedAt,
                    status: dispatch.status,
                });
            }
        }
        return map;
    }, [sprintDispatches]);

    const { filteredTasks, taskCounts } = useMemo(() => {
        const filteredTasks: Subtask[] = [];
        const targetStatus = FILTER_STATUS_MAP[activeFilter];
        let pendingCount = 0;

        for (const task of visibleTasksWithLiveActivities) {
            const phase = getTaskProgressPhase(task);
            const isPending = phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";

            if (isPending) {
                pendingCount += 1;
            }

            if (
                activeFilter === "All"
                || (activeFilter === "Pending" && isPending)
                || (activeFilter !== "Pending" && targetStatus !== null && phase === targetStatus)
            ) {
                filteredTasks.push(task);
            }
        }

        return {
            filteredTasks,
            taskCounts: {
                All: visibleTasksWithLiveActivities.length,
                Running: visibleStats.running,
                Completed: visibleStats.completed,
                Failed: visibleStats.failed,
                Pending: pendingCount,
            } satisfies Record<TaskFilter, number>,
        };
    }, [activeFilter, visibleStats, visibleTasksWithLiveActivities]);

    const taskCardItems = useMemo(() => (
        filteredTasks.map((task) => {
            const taskRuntimeId = task.record_id || task.id;
            const dispatchInfo = task.record_id ? dispatchInfoByTaskId.get(task.record_id) : undefined;

            return {
                key: taskRuntimeId,
                task,
                taskTiming: taskTimingMap.get(taskRuntimeId) || taskTimingMap.get(task.id) || null,
                events: (task.record_id && taskEventsByRecordId.byRecordId.get(task.record_id))
                    || taskEventsByRecordId.byTaskKey.get(task.id)
                    || EMPTY_RUNTIME_EVENTS,
                isRerunning: rerunningIds.has(taskRuntimeId),
                dispatchError: dispatchInfo?.errorMessage ?? null,
                dispatchStartedAt: dispatchInfo?.startedAt ?? null,
                dispatchFinishedAt: dispatchInfo?.finishedAt ?? null,
                dispatchStatus: dispatchInfo?.status ?? null,
            };
        })
    ), [dispatchInfoByTaskId, filteredTasks, rerunningIds, taskEventsByRecordId, taskTimingMap]);

    const protocolMarkup = useMemo(() => (
        renderMarkdown(hasSprintContext ? status.instructions : undefined)
        || '<p class="text-slate-400 dark:text-slate-600 italic">No active sprint protocol.</p>'
    ), [hasSprintContext, status.instructions]);

    /* Connection error — only show full-page error if we have NO prior data.
       If we already loaded sprint data, keep showing it with an inline warning
       so the view doesn't flicker away on transient network blips. */
    if (error && !hasSprintContext && !initialLoadComplete) {
        return (
            <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex items-center justify-center min-h-[60vh]">
                <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-status-red/20 rounded-xl p-12 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] text-center max-w-lg">
                    <WaveFluid accentHex="#E3000F" />
                    <div className="relative z-10">
                        <div className="w-16 h-16 rounded-xl bg-status-red/10 flex items-center justify-center mx-auto mb-5">
                            <Zap className="w-8 h-8 text-status-red" strokeWidth={1} />
                        </div>
                        <h2 className="text-2xl font-black tracking-tighter font-display text-slate-900 dark:text-white mb-3">Connection Lost</h2>
                        <p className="text-sm text-slate-500 max-w-xs mx-auto">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">

            {/* Inline connection warning — shown when we have prior data but lost connection */}
            {error && (hasSprintContext || initialLoadComplete) && (
                <div className="flex items-center gap-3 px-5 py-3 rounded-xl border border-status-red/15 bg-status-red/5 text-sm text-status-red font-medium backdrop-blur-md">
                    <Zap className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span>{error} — showing last known state, reconnecting...</span>
                </div>
            )}

            {/* ── Page Header ─────────────────────────────────────────── */}
            <div ref={headerRef} className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-8">
                <div className="flex flex-col gap-5">
                    {/* Eyebrow */}
                    <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <Radio className="w-3.5 h-3.5 text-status-red" strokeWidth={2.5} />
                        <span className="text-status-red">Live Session</span>
                        {(liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber) != null && (
                            <span className="text-slate-400 ml-1">· Sprint {liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber}</span>
                        )}
                    </div>

                    {/* Hero headline */}
                    <div className="relative overflow-hidden">
                        <h2
                            aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none"
                        >
                            LIVE
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            Sprint <br />
                            <span className="text-signal-500">Pipeline.</span>
                        </h1>
                    </div>

                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                        {hasLiveSprint
                            ? status.feature_branch
                                ? <>Monitoring <span className="font-mono text-signal-600 dark:text-signal-400">{status.feature_branch}</span> in real-time.</>
                                : `Monitoring ${liveSprintRun?.sprintName || "the active sprint"} in real-time.`
                            : pausedIntervention
                                ? pausedIntervention.instructions
                                : hasSprintContext
                                    ? "Viewing the latest sprint telemetry snapshot."
                                    : !initialLoadComplete
                                        ? "Connecting to orchestrator..."
                                        : "Waiting for sprint to start."
                        }
                    </p>
                </div>

                {/* Right: pills + view toggle + timestamp */}
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* ── View Toggle ─────────────────────────────── */}
                        <div className="flex gap-0.5 p-0.5 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl backdrop-blur-md">
                            <button
                                type="button"
                                onClick={() => setHeaderView("stats")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
                                    headerView === "stats"
                                        ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
                                        : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                }`}
                            >
                                <BarChart3 className="w-3 h-3" strokeWidth={2} />
                                Stats
                            </button>
                            <button
                                type="button"
                                onClick={() => setHeaderView("race")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
                                    headerView === "race"
                                        ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
                                        : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                }`}
                            >
                                <Ship className="w-3 h-3" strokeWidth={2} />
                                Race
                            </button>
                            <button
                                type="button"
                                onClick={() => setHeaderView("dag")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
                                    headerView === "dag"
                                        ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
                                        : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                }`}
                            >
                                <Workflow className="w-3 h-3" strokeWidth={2} />
                                DAG
                            </button>
                        </div>

                        <div className={`px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full border flex items-center gap-2.5 backdrop-blur-md ${
                            hasLiveSprint
                                ? "bg-signal-500/8 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border-signal-500/15 dark:border-signal-500/20 shadow-[0_0_20px_rgba(0,224,160,0.08)]"
                                : pausedIntervention
                                    ? "bg-status-amber/10 text-status-amber border-status-amber/20"
                                    : "bg-black/[0.04] dark:bg-white/[0.04] text-slate-500 border-black/[0.06] dark:border-white/[0.06]"
                        }`}>
                            <span className={`w-2 h-2 rounded-full relative ${hasLiveSprint ? "bg-signal-500" : pausedIntervention ? "bg-status-amber" : "bg-slate-400"}`}>
                                {hasLiveSprint && <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />}
                            </span>
                            {hasLiveSprint ? `${visibleStats.running} Running` : pausedIntervention ? "Paused for intervention" : hasSprintContext ? "Snapshot loaded" : !initialLoadComplete ? "Connecting" : "Waiting"}
                        </div>
                        {pausedIntervention && !hasLiveSprint && (
                            <HumanInterventionBadge summary={pausedIntervention} label="Needs you" align="right" />
                        )}
                        {visibleStats.failed > 0 && (
                            <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full
                                           bg-status-red/8 text-status-red border border-status-red/15
                                           flex items-center gap-2.5 backdrop-blur-md">
                                <span className="w-2 h-2 rounded-full bg-status-red relative">
                                    <span className="absolute inset-0 rounded-full animate-ping bg-status-red opacity-50" />
                                </span>
                                {visibleStats.failed} Failed
                            </div>
                        )}
                    </div>
                    {status.timestamp && hasSprintContext && (
                        <span className="text-[10px] font-mono text-slate-400">
                            Updated {formatTime(status.timestamp)}
                        </span>
                    )}
                </div>
            </div>

            {pausedIntervention && !hasLiveSprint && (
                <div className="relative overflow-hidden rounded-xl border border-status-amber/18 bg-status-amber/8 p-6 shadow-[0_12px_30px_rgba(245,158,11,0.08)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                                <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.2} />
                                Sprint Paused For Human Intervention
                            </div>
                            <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white font-display">
                                {pausedIntervention.title}
                            </h3>
                            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                {pausedIntervention.reason}
                            </p>
                            <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                What to do now
                            </div>
                            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                {pausedIntervention.instructions}
                            </p>
                        </div>
                        <div className="shrink-0">
                            <HumanInterventionBadge summary={pausedIntervention} label="Details" align="right" />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Header View: Stats or Boat Race ─────────────────────── */}
            {headerView === "stats" ? (
                <SprintStatsDeck
                    hasSprintContext={hasSprintContext}
                    stats={visibleStats}
                    tasks={visibleTasksWithLiveActivities}
                    sprintTiming={sprintTiming}
                />
            ) : headerView === "race" ? (
                /* ── Boat Race View ───────────────────────────────── */
                <Suspense fallback={<SkeletonPanel />}>
                    <SprintBoatRace
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasLiveSprint={hasLiveSprint}
                    />
                </Suspense>
            ) : (
                <Suspense fallback={<SkeletonPanel />}>
                    <SprintDag
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasSprintContext={hasSprintContext}
                    />
                </Suspense>
            )}

            {/* ── Section Divider ─────────────────────────────────────── */}
            <div className="w-full flex items-center justify-center py-4 relative z-10 overflow-hidden">
                <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
                <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06] dark:border-white/[0.06] rounded-full shadow-sm relative z-10 text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-600">
                    Task Pipeline
                </div>
            </div>

            {/* ── Filter Strip ────────────────────────────────────────── */}
            <div className="-mt-8 flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
                {TASK_FILTERS.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setFilter(filter)}
                        className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-lg
                                   transition-all duration-200 flex items-center gap-2
                                   ${activeFilter === filter
                                       ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                                       : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                   }`}
                    >
                        {filter}
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md
                            ${activeFilter === filter
                                ? "bg-signal-500/[0.12] text-signal-600 dark:text-signal-400"
                                : "bg-black/[0.06] dark:bg-white/[0.06] text-slate-400"
                            }`}>
                            {taskCounts[filter]}
                        </span>
                    </button>
                ))}
            </div>

            {/* ── Main Content Grid ───────────────────────────────────── */}
            <div ref={contentRef} className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-16">

                {/* Task cards */}
                <div className="xl:col-span-8 flex flex-col gap-5">
                    {!hasSprintContext && !initialLoadComplete ? (
                        /* Initial load in progress — render nothing to avoid flashing idle placeholder */
                        null
                    ) : !hasSprintContext ? (
                        <IdleRuntimeState
                            title={pausedIntervention ? "Human Intervention Needed" : "Waiting for Sprint Start"}
                            subtitle={pausedIntervention
                                ? pausedIntervention.instructions
                                : "Launch a sprint to activate live task telemetry, protocol output, and runtime activity for this project."}
                        />
                    ) : taskCardItems.length === 0 ? (
                        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border-2 border-dashed border-black/[0.06] dark:border-white/[0.06] rounded-xl p-16 text-center">
                            <div className="relative z-10">
                                <Play className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1} />
                                <p className="text-sm text-slate-400 dark:text-slate-600 font-medium">
                                    {activeFilter === "All"
                                        ? "Awaiting sprint decomposition..."
                                        : `No ${activeFilter.toLowerCase()} tasks.`
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        taskCardItems.map(({ key, task, taskTiming, events, isRerunning, dispatchError, dispatchStartedAt, dispatchFinishedAt, dispatchStatus }) => (
                            <LiveTaskCard
                                key={key}
                                task={task}
                                taskTiming={taskTiming}
                                events={events}
                                onRerun={handleRerun}
                                isRerunning={isRerunning}
                                dispatchError={dispatchError}
                                dispatchStartedAt={dispatchStartedAt}
                                dispatchFinishedAt={dispatchFinishedAt}
                                dispatchStatus={dispatchStatus}
                            />
                        ))
                    )}
                </div>

                {/* Sidebar — Reordered: Latest Activity & Git at top, collapsible panels */}
                <div className="xl:col-span-4 flex flex-col gap-5">
                    {/* 1. Latest Activity — always visible at top */}
                    <IntelPanel
                        title="Latest Activity"
                        icon={Activity}
                        accentHex="#00E0A0"
                        content={hasSprintContext ? status.reportText : undefined}
                        fallback={hasSprintContext ? "Waiting for activity..." : !initialLoadComplete ? "Connecting..." : "Waiting for sprint to start."}
                    />

                    {/* 2. Git/CI — moved to top, always visible */}
                    <GitCIStatusPanel status={gitStatus} error={gitStatusError} />

                    {/* 3. Execution Runtime — collapsible */}
                    <ExecutionTimelineProvider
                        execution={execution}
                        onOrchestrateSprint={handleOrchestrateSprint}
                        onPauseSprintRun={handlePauseSprintRun}
                        onCancelSprintRun={handleCancelSprintRun}
                        onForceCancelSprintRun={handleForceCancelSprintRun}
                        onCancelTaskDispatch={handleCancelTaskDispatch}
                        onForceCancelTaskDispatch={handleForceCancelTaskDispatch}
                        onRetryTaskDispatch={handleRetryTaskDispatch}
                        onClaimAttentionItem={handleClaimAttentionItem}
                        onResolveAttentionItem={handleResolveAttentionItem}
                        onDismissAttentionItem={handleDismissAttentionItem}
                        pendingActionIds={pendingActionIds}
                    >
                        <ExecutionRuntimePanel
                            collapsible
                            defaultOpen={hasSprintContext}
                        />
                    </ExecutionTimelineProvider>

                    {/* 4. Protocol — collapsible */}
                    <CollapsiblePanel
                        title="Protocol"
                        icon={AlertTriangle}
                        accentHex="#FFB800"
                        defaultOpen={false}
                    >
                        <div
                            className="prose prose-sm max-w-none text-slate-600 dark:text-slate-400
                                       prose-headings:text-slate-800 dark:prose-headings:text-slate-200
                                       prose-code:text-signal-600 dark:prose-code:text-signal-400
                                       prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md
                                       font-mono text-[12px] leading-relaxed max-h-64 overflow-y-auto dashboard-scrollbar"
                            dangerouslySetInnerHTML={{ __html: protocolMarkup }}
                        />
                    </CollapsiblePanel>
                </div>
            </div>
        </div>
    );
};
