import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
    Zap, GitBranch, Clock, CheckCircle2, XCircle, AlertTriangle,
    Activity, ChevronDown, ChevronRight, Radio, Terminal, RefreshCw,
    GitPullRequest, GitMerge, CircleDot, ExternalLink, Eye, EyeOff,
    Play, FileText, RotateCcw, Bot, Workflow, PauseCircle,
    Ship, BarChart3, Anchor, Timer,
} from "lucide-preact";
import { SprintBoatRace } from "./components/SprintBoatRace.js";
import { SprintDag } from "./components/SprintDag.js";
import { SprintStatsDeck, TaskStagePills, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { HumanInterventionBadge } from "./components/ui/HumanInterventionBadge.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { useLiveSessionActions } from "./hooks/use-live-session-actions.js";
import { formatTime } from "../lib/time.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask, GitTrackingStatus, ExecutionDashboardSnapshot, ExecutionRuntimeEventSummary } from "../types.js";
import { deriveLiveSessionRuntimeState } from "./lib/live-session-runtime.js";
import { getTaskProgressPhase } from "../lib/task-progress.js";
import type { LiveTaskTimingSummary } from "./lib/live-stats.js";

import { IntelPanel } from "./components/ui/IntelPanel.js";
import { CollapsiblePanel } from "./components/ui/CollapsiblePanel.js";
import { IdleRuntimeState } from "./components/ui/IdleRuntimeState.js";
import {
    TASK_STATUS_CFG,
    getTaskCfg,
    MERGE_INDICATOR_CFG,
    ORIGINATOR_CFG,
    getOriginatorCfg,
    EMPTY_RUNTIME_STATS,
    getExecutionEventText,
} from "./lib/live-session-config.js";

/* ─── Runtime Event Feed ─────────────────────────────────────────────────── */

const RuntimeEventFeed: FunctionComponent<{ events?: ExecutionRuntimeEventSummary[] }> = ({ events }) => {
    const feedRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = feedRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events]);

    if (!events || events.length === 0) {
        return (
            <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-600">
                <div className="text-center">
                    <Terminal className="w-6 h-6 mx-auto mb-3 opacity-40" strokeWidth={1} />
                    <p className="text-xs font-mono">Awaiting runtime events...</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="max-h-64 overflow-y-auto pr-2 dashboard-scrollbar space-y-1">
            {events.map((event) => {
                const cfg = getOriginatorCfg(event.originator || "system");
                return (
                    <div key={event.id} className={`flex gap-3 border-l-2 ${cfg.border} pl-3 py-2 group/entry hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded-r-lg transition-colors duration-200`}>
                        <div className="flex-grow min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${cfg.text}`}>
                                    {cfg.label}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                    {event.eventType.replace(/_/g, " ")}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono">
                                    {formatTime(event.createdAt)}
                                </span>
                            </div>
                            <div className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed font-mono line-clamp-2 group-hover/entry:line-clamp-none transition-all cursor-default">
                                {getExecutionEventText(event)}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};



/* ─── Task Card (V2) ─────────────────────────────────────────────────────── */

const LiveTaskCard: FunctionComponent<{
    task: Subtask;
    taskTiming?: LiveTaskTimingSummary | null;
    events?: ExecutionRuntimeEventSummary[];
    onRerun: (id: string) => void;
    isRerunning: boolean;
    dispatchError?: string | null;
    dispatchStartedAt?: string | null;
    dispatchFinishedAt?: string | null;
}> = ({ task, taskTiming, events, onRerun, isRerunning, dispatchError, dispatchStartedAt, dispatchFinishedAt }) => {
    const [expanded, setExpanded] = useState(false);
    const [showFeed, setShowFeed] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const taskPhase = getTaskProgressPhase(task);
    const cfg = getTaskCfg(taskPhase);
    const StatusIcon = cfg.icon;
    const hasEventFeed = Boolean(events && events.length > 0);
    const mergeCfg = task.merge_indicator ? MERGE_INDICATOR_CFG[task.merge_indicator] : null;
    const sessionLabel = (task.session_id || task.session_name || "").replace(/^sessions\//, "");

    const handleRerun = () => {
        const confirmed = window.confirm(`Rerun task "${task.id}"?\n\nThis resets the task state and discards current progress.`);
        if (confirmed) onRerun(task.record_id || task.id);
    };

    return (
        <div
            ref={cardRef}
            className="group relative overflow-hidden
                       bg-white/70 dark:bg-void-800/60
                       backdrop-blur-2xl
                       border border-black/[0.06] dark:border-white/[0.06]
                       rounded-[1.75rem] p-7
                       shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
                       transition-[border-color] duration-300"
        >
            <WaveFluid accentHex={cfg.hex} />
            <BorderTrace accentHex={cfg.hex} />

            {/* Hover tint */}
            <div className="absolute inset-0 pointer-events-none transition-colors duration-300 group-hover:bg-black/[0.01] dark:group-hover:bg-white/[0.01]" />

            {/* Ghost ID watermark */}
            <div
                aria-hidden
                className="absolute -right-3 -top-6 font-black font-display
                           text-[7rem] leading-none tracking-tighter
                           text-black/[0.02] dark:text-white/[0.015]
                           pointer-events-none select-none"
            >
                #{task.id}
            </div>

            <div className="relative z-10">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        {/* Status icon blob */}
                        <div
                            className="w-10 h-10 rounded-[0.875rem] flex items-center justify-center shrink-0 mt-0.5"
                            style={{ backgroundColor: `${cfg.hex}14` }}
                        >
                            <span style={{ color: cfg.hex }}><StatusIcon className="w-5 h-5" strokeWidth={1.5} /></span>
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] text-slate-400">
                                    #{task.id}
                                </span>
                                {/* Status badge */}
                                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
                                    {cfg.label}
                                </span>
                                {mergeCfg && (
                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${mergeCfg.bg} ${mergeCfg.text} border ${mergeCfg.border}`}>
                                        {mergeCfg.label}
                                    </span>
                                )}
                            </div>
                            <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                                {task.title}
                            </h3>
                        </div>
                    </div>

                    {/* Right meta column */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        {task.provider && (
                            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.1em] text-slate-300 dark:text-slate-600">
                                {task.provider}
                            </span>
                        )}
                        {taskTiming && taskTiming.totalSeconds > 0 ? (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                                <Timer className="w-3 h-3" strokeWidth={2} />
                                <span>{formatDuration(taskTiming.totalSeconds)}</span>
                            </div>
                        ) : (
                            <TaskDuration startedAt={dispatchStartedAt ?? null} finishedAt={dispatchFinishedAt ?? null} status={taskPhase} />
                        )}
                        {(hasEventFeed || task.session_id || task.session_name) && (
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 max-w-[100px] truncate" title={sessionLabel}>
                                {sessionLabel.substring(0, 16)}
                            </span>
                        )}
                    </div>
                </div>

                <TaskStagePills timing={taskTiming} />

                {/* Prompt preview — collapsed */}
                {!expanded && !showFeed && (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="text-[13px] text-slate-400 dark:text-slate-500 line-clamp-1 text-left w-full
                                   hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200
                                   mb-4 font-medium"
                    >
                        {task.prompt.substring(0, 140)}...
                    </button>
                )}

                {/* Expanded prompt */}
                {expanded && (
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex items-center gap-2 mb-3">
                            <FileText className="w-3 h-3 text-slate-400" strokeWidth={2} />
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Task Prompt</span>
                        </div>
                        <div
                            className="prose prose-sm max-w-none text-slate-600 dark:text-slate-400
                                       prose-headings:text-slate-800 dark:prose-headings:text-slate-200
                                       prose-code:text-signal-600 dark:prose-code:text-signal-400
                                       prose-code:bg-signal-500/[0.06] prose-code:px-1.5 prose-code:rounded-md
                                       prose-strong:text-slate-800 dark:prose-strong:text-slate-200
                                       prose-a:text-signal-600 dark:prose-a:text-signal-400
                                       font-mono text-[12px] leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(task.prompt) }}
                        />
                    </div>
                )}

                {/* Live session feed */}
                {showFeed && (
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Runtime Feed</span>
                        </div>
                        <RuntimeEventFeed events={events} />
                    </div>
                )}

                {/* Dispatch error / quota countdown */}
                {dispatchError && (
                    <div className="mb-4 rounded-xl border border-status-amber/15 bg-status-amber/[0.04] px-4 py-2.5">
                        <QuotaCountdown errorMessage={dispatchError} />
                    </div>
                )}

                {/* Action bar */}
                <div className="flex items-center justify-between pt-4 border-t border-black/[0.04] dark:border-white/[0.04]">
                    <div className="flex items-center gap-2">
                        {hasEventFeed && (
                            <button
                                type="button"
                                onClick={() => { setShowFeed(!showFeed); if (expanded) setExpanded(false); }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em]
                                           transition-all duration-200 border
                                           ${showFeed
                                               ? 'bg-signal-500/10 text-signal-500 border-signal-500/20 shadow-[0_0_12px_rgba(0,224,160,0.08)]'
                                               : 'bg-black/[0.03] dark:bg-white/[0.03] text-slate-400 border-transparent hover:text-signal-500 hover:border-signal-500/15'
                                           }`}
                            >
                                {showFeed ? <EyeOff className="w-3 h-3" strokeWidth={2} /> : <Eye className="w-3 h-3" strokeWidth={2} />}
                                {showFeed ? "Hide Feed" : "Runtime Feed"}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => { setExpanded(!expanded); if (showFeed) setShowFeed(false); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em]
                                       transition-all duration-200 border
                                       ${expanded
                                           ? 'bg-ember-500/10 text-ember-500 border-ember-500/20'
                                           : 'bg-black/[0.03] dark:bg-white/[0.03] text-slate-400 border-transparent hover:text-ember-500 hover:border-ember-500/15'
                                       }`}
                        >
                            {expanded ? <ChevronDown className="w-3 h-3" strokeWidth={2.5} /> : <ChevronRight className="w-3 h-3" strokeWidth={2.5} />}
                            Prompt
                        </button>
                        <button
                            type="button"
                            onClick={handleRerun}
                            disabled={isRerunning}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em]
                                       bg-black/[0.03] dark:bg-white/[0.03] text-slate-400 border border-transparent
                                       hover:text-status-amber hover:border-status-amber/15
                                       disabled:opacity-40 disabled:pointer-events-none
                                       transition-all duration-200"
                        >
                            <RotateCcw className={`w-3 h-3 ${isRerunning ? 'animate-spin' : ''}`} strokeWidth={2} />
                            {isRerunning ? "Rerunning" : "Rerun"}
                        </button>
                    </div>
                    {task.pr_url && (
                        <a
                            href={task.pr_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-[10px] font-mono text-signal-500 hover:text-signal-400 transition-colors duration-200"
                        >
                            <GitPullRequest className="w-3 h-3" strokeWidth={2} />
                            PR
                            <ExternalLink className="w-2.5 h-2.5 opacity-50" strokeWidth={2} />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ─── Git/CI Panel ───────────────────────────────────────────────────────── */

const statusTone = (value: string | null): string => {
    if (!value) return "text-slate-400";
    const n = value.toUpperCase();
    if (n === "SUCCESS" || n === "COMPLETED" || n === "MERGED") return "text-status-green";
    if (n === "CANCEL_REQUESTED") return "text-status-amber";
    if (n === "IN_PROGRESS" || n === "QUEUED" || n === "PENDING" || n === "QUOTA") return "text-status-amber";
    if (n === "FAILURE" || n === "FAILED" || n === "ERROR" || n === "CANCELLED") return "text-status-red";
    return "text-slate-400";
};

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

function extractRetryAfterIso(errorMessage: string): string | null {
    const match = errorMessage.match(/\[RETRY_AFTER:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
    return match?.[1] ?? null;
}

function formatDuration(totalSeconds: number): string {
    if (totalSeconds <= 0) return "0s";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

const QuotaCountdown: FunctionComponent<{ errorMessage: string }> = ({ errorMessage }) => {
    const retryIso = extractRetryAfterIso(errorMessage);
    const [remaining, setRemaining] = useState(() =>
        retryIso ? Math.max(0, Math.floor((new Date(retryIso).getTime() - Date.now()) / 1000)) : null
    );

    useEffect(() => {
        if (!retryIso) { setRemaining(null); return; }
        const update = () => Math.max(0, Math.floor((new Date(retryIso).getTime() - Date.now()) / 1000));
        setRemaining(update());
        const timer = window.setInterval(() => {
            const left = update();
            setRemaining(left);
            if (left <= 0) window.clearInterval(timer);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [retryIso]);

    if (remaining == null) {
        return <div className="text-status-red">{errorMessage}</div>;
    }

    return (
        <div className="flex items-center gap-2 text-status-amber">
            <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
            <span>
                {remaining <= 0
                    ? "Quota should be available now — retry the task."
                    : `Quota exhausted — resets in ${formatDuration(remaining)}`}
            </span>
        </div>
    );
};

const TaskDuration: FunctionComponent<{ startedAt: string | null; finishedAt: string | null; status: string }> = ({ startedAt, finishedAt, status }) => {
    const [elapsed, setElapsed] = useState(0);
    const isRunning = status === "RUNNING" || status === "running";

    useEffect(() => {
        if (!startedAt) { setElapsed(0); return; }
        const start = new Date(startedAt).getTime();
        const compute = () => {
            const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
            return Math.max(0, Math.floor((end - start) / 1000));
        };
        setElapsed(compute());
        if (!finishedAt && isRunning) {
            const timer = window.setInterval(() => setElapsed(compute()), 1000);
            return () => window.clearInterval(timer);
        }
    }, [startedAt, finishedAt, isRunning]);

    if (!startedAt || elapsed === 0) return null;

    return (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
            <Timer className="w-3 h-3" strokeWidth={2} />
            <span>{formatDuration(elapsed)}</span>
        </div>
    );
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
        <div className="rounded-[1.4rem] border border-black/[0.04] bg-black/[0.015] p-4 dark:border-white/[0.04] dark:bg-white/[0.015]">
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
    snapshot: ExecutionDashboardSnapshot;
    onOrchestrateSprint: (projectId: string, sprintId: string) => void;
    onPauseSprintRun: (sprintRunId: string) => void;
    onCancelSprintRun: (sprintRunId: string) => void;
    onForceCancelSprintRun: (sprintRunId: string) => void;
    onCancelTaskDispatch: (dispatchId: string) => void;
    onForceCancelTaskDispatch: (dispatchId: string) => void;
    onRetryTaskDispatch: (dispatchId: string) => void;
    onClaimAttentionItem: (projectId: string, attentionItemId: string) => void;
    onResolveAttentionItem: (projectId: string, attentionItemId: string) => void;
    onDismissAttentionItem: (projectId: string, attentionItemId: string) => void;
    pendingActionIds: Set<string>;
    collapsible?: boolean;
    defaultOpen?: boolean;
}> = ({
    snapshot,
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
    collapsible = false,
    defaultOpen = true,
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const activeSprintRuns = snapshot.sprintRuns.filter((run) => run.status === "running" || run.status === "queued");
    const activeDispatches = snapshot.taskDispatches.filter((dispatch) => (
        dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running"
    ));
    const activeConnections = snapshot.connections.filter((connection) => connection.status !== "offline");
    const workerDispatches = activeDispatches.filter((dispatch) => dispatch.executorType === "mcp_worker");
    const queuedWorkers = workerDispatches.filter((dispatch) => dispatch.status === "queued").length;
    const runningWorkers = workerDispatches.filter((dispatch) => dispatch.status === "claimed" || dispatch.status === "running").length;
    const timelineEvents = activeSprintRuns.length > 0 ? snapshot.recentEvents.slice(0, 24) : [];

    return (
        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
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
                                            <TaskDuration startedAt={dispatch.startedAt} finishedAt={dispatch.finishedAt} status={dispatch.status} />
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

                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">Runtime Timeline</span>
                    {timelineEvents.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No task run events recorded yet.</p>
                    ) : (
                        <div className="max-h-72 overflow-y-auto dashboard-scrollbar pr-1">
                            <RuntimeEventFeed events={timelineEvents} />
                        </div>
                    )}
                </div>
            </div>
            </div>
            </div>
        </div>
    );
};

const GitCiPanel: FunctionComponent<{ status: GitTrackingStatus | null; error: string | null }> = ({ status, error }) => {
    if (error) {
        return (
            <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-status-red/20 rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
                <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-status-red" strokeWidth={1.5} />
                    <div>
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-status-red">Git Tracking Error</span>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!status) {
        return (
            <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Loading git status...</span>
            </div>
        );
    }

    return (
        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#00E0A0" />
            <BorderTrace accentHex="#00E0A0" />

            <div className="relative z-10 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <GitBranch className="w-4 h-4 text-signal-500" strokeWidth={1.5} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Git / CI / PR</span>
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full ${status.mode === "REMOTE" ? "bg-signal-500/8 text-signal-500 border border-signal-500/15" : "bg-black/[0.04] dark:bg-white/[0.04] text-slate-400"}`}>
                        {status.mode}
                    </span>
                </div>

                {/* Branch info */}
                <div className="grid grid-cols-2 gap-3">
                    {[
                        { label: "Branch", value: status.branch ?? "—" },
                        { label: "Workspace", value: status.dirty ? "Dirty" : "Clean" },
                        { label: "Tracking", value: status.tracking.label },
                        { label: "Updated", value: formatTime(status.lastUpdated) },
                    ].map(({ label, value }) => (
                        <div key={label} className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02]">
                            <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-1">{label}</span>
                            <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300 truncate block">{value}</span>
                        </div>
                    ))}
                </div>

                {/* Warnings */}
                {status.warnings.length > 0 && (
                    <div className="p-4 rounded-xl border border-status-amber/20 bg-status-amber/[0.04]">
                        <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-status-amber block mb-2">Warnings</span>
                        {status.warnings.map((w) => (
                            <p key={w} className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{w}</p>
                        ))}
                    </div>
                )}

                {/* Open PRs */}
                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">
                        <GitPullRequest className="w-3 h-3 inline mr-1.5 -mt-px" strokeWidth={2} />
                        Open PRs
                    </span>
                    {status.openPullRequests.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No open PRs tracked.</p>
                    ) : (
                        <div className="space-y-2">
                            {status.openPullRequests.slice(0, 5).map((pr) => (
                                <a
                                    key={pr.url}
                                    href={pr.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block p-3 rounded-xl border border-black/[0.04] dark:border-white/[0.04]
                                               bg-black/[0.015] dark:bg-white/[0.015]
                                               hover:border-signal-500/20 hover:bg-signal-500/[0.02]
                                               transition-all duration-200 group/pr"
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">#{pr.number} {pr.title}</span>
                                        <ExternalLink className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover/pr:text-signal-500 transition-colors duration-200" strokeWidth={2} />
                                    </div>
                                    <p className="text-[10px] font-mono text-slate-400">{pr.headRefName ?? "?"} → {pr.baseRefName ?? "?"}</p>
                                    <p className={`text-[10px] font-mono mt-0.5 ${statusTone(pr.mergeStateStatus)}`}>
                                        merge: {pr.mergeStateStatus ?? "UNKNOWN"} · comments: {pr.comments}
                                    </p>
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                {/* CI Runs */}
                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">
                        <CircleDot className="w-3 h-3 inline mr-1.5 -mt-px" strokeWidth={2} />
                        CI Runs
                    </span>
                    {status.ciRuns.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No CI runs tracked.</p>
                    ) : (
                        <div className="space-y-2">
                            {status.ciRuns.slice(0, 5).map((run) => (
                                <a
                                    key={`${run.id ?? run.url}`}
                                    href={run.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block p-3 rounded-xl border border-black/[0.04] dark:border-white/[0.04]
                                               bg-black/[0.015] dark:bg-white/[0.015]
                                               hover:border-signal-500/20 transition-all duration-200"
                                >
                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{run.workflowName || run.name}</span>
                                    <p className={`text-[10px] font-mono mt-0.5 ${statusTone(run.conclusion || run.status)}`}>
                                        {run.status}{run.conclusion ? ` / ${run.conclusion}` : ""}
                                    </p>
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                {/* Merged PRs */}
                <div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">
                        <GitMerge className="w-3 h-3 inline mr-1.5 -mt-px" strokeWidth={2} />
                        Recent Merges
                    </span>
                    {status.mergedPullRequests.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No recent merges.</p>
                    ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto dashboard-scrollbar pr-1">
                            {status.mergedPullRequests.map((merged) => (
                                <a
                                    key={merged.url}
                                    href={merged.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block p-3 rounded-xl border border-black/[0.04] dark:border-white/[0.04]
                                               bg-black/[0.015] dark:bg-white/[0.015]
                                               hover:border-status-green/20 transition-all duration-200"
                                >
                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">#{merged.number} {merged.title}</span>
                                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">{merged.headRefName ?? "?"} → {merged.baseRefName ?? "?"}</p>
                                    <p className="text-[10px] font-mono text-status-green mt-0.5">merged {formatTime(merged.mergedAt ?? undefined)}</p>
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ─── Protocol / Activity Panels ─────────────────────────────────────────── */



/* ─── Collapsible Panel Wrapper ──────────────────────────────────────────── */



/* ─── Header View Type ──────────────────────────────────────────────────── */

type HeaderView = "stats" | "race" | "dag";

/* ─── Filter Type ────────────────────────────────────────────────────────── */

type TaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

const FILTER_STATUS_MAP: Record<TaskFilter, string | null> = {
    All: null, Running: "RUNNING", Completed: "COMPLETED", Failed: "FAILED", Pending: "PENDING",
};

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export const LiveSessionPage: FunctionComponent = () => {
    const headerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const { error, execution, gitStatus, gitStatusError, refreshRuntimeStatus, refreshGitStatus, status, stats, tasksWithLiveActivities } = useDashboardRuntimeData();
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
        () => deriveLiveSessionRuntimeState(status, execution),
        [status, execution],
    );
    const liveSprintRun = runtimeState.liveSprintRun;
    const pausedInterventionRun = runtimeState.pausedInterventionRun;
    const pausedIntervention = pausedInterventionRun?.humanIntervention || null;
    const hasLiveSprint = runtimeState.hasActiveSprint;
    const hasSprintContext = runtimeState.hasSprintContext;
    const [nowIso, setNowIso] = useState(() => new Date().toISOString());
    const visibleTasksWithLiveActivities = hasSprintContext ? tasksWithLiveActivities : [];
    const visibleStats = hasSprintContext ? stats : EMPTY_RUNTIME_STATS;

    useEffect(() => {
        setNowIso(new Date().toISOString());
        if (!hasSprintContext) {
            return;
        }
        const timer = window.setInterval(() => {
            setNowIso(new Date().toISOString());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [hasSprintContext]);

    const { sprintTiming, taskTimingMap } = useLiveTaskTimingSummaries({
        tasks: visibleTasksWithLiveActivities,
        dispatches: execution.taskDispatches,
        events: execution.recentEvents,
        sprintRuns: execution.sprintRuns,
        nowIso,
    });

    const filtered = useMemo(() => {
        if (activeFilter === "All") return visibleTasksWithLiveActivities;
        if (activeFilter === "Pending") return visibleTasksWithLiveActivities.filter(t => {
            const phase = getTaskProgressPhase(t);
            return phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";
        });
        const target = FILTER_STATUS_MAP[activeFilter];
        return visibleTasksWithLiveActivities.filter(t => getTaskProgressPhase(t) === target);
    }, [visibleTasksWithLiveActivities, activeFilter]);

    const taskEventsByRecordId = useMemo(() => {
        const byRecordId = new Map<string, ExecutionRuntimeEventSummary[]>();
        const byTaskKey = new Map<string, ExecutionRuntimeEventSummary[]>();
        for (const event of execution.recentEvents) {
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
    }, [execution.recentEvents]);

    const dispatchInfoByTaskId = useMemo(() => {
        const map = new Map<string, { errorMessage: string | null; startedAt: string | null; finishedAt: string | null }>();
        for (const dispatch of execution.taskDispatches) {
            if (!dispatch.taskId) continue;
            const existing = map.get(dispatch.taskId);
            // Keep the most recent dispatch (last in list), but prefer one with error if present
            if (!existing || dispatch.errorMessage || (!existing.errorMessage && dispatch.startedAt)) {
                map.set(dispatch.taskId, {
                    errorMessage: dispatch.errorMessage,
                    startedAt: dispatch.startedAt,
                    finishedAt: dispatch.finishedAt,
                });
            }
        }
        return map;
    }, [execution.taskDispatches]);

    const counts: Record<TaskFilter, number> = useMemo(() => ({
        All:       visibleTasksWithLiveActivities.length,
        Running:   visibleStats.running,
        Completed: visibleStats.completed,
        Failed:    visibleStats.failed,
        Pending:   visibleTasksWithLiveActivities.filter(t => {
            const phase = getTaskProgressPhase(t);
            return phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";
        }).length,
    }), [visibleStats, visibleTasksWithLiveActivities]);

    /* Connection error */
    if (error) {
        return (
            <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex items-center justify-center min-h-[60vh]">
                <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-status-red/20 rounded-[1.75rem] p-12 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] text-center max-w-lg">
                    <WaveFluid accentHex="#E3000F" />
                    <div className="relative z-10">
                        <div className="w-16 h-16 rounded-[1.25rem] bg-status-red/10 flex items-center justify-center mx-auto mb-5">
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
                                    ? "Loading the latest sprint telemetry snapshot."
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
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
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
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
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
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
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
                            {hasLiveSprint ? `${visibleStats.running} Running` : pausedIntervention ? "Paused for intervention" : hasSprintContext ? "Snapshot loaded" : "Waiting"}
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
                <div className="relative overflow-hidden rounded-[1.75rem] border border-status-amber/18 bg-status-amber/8 p-6 shadow-[0_12px_30px_rgba(245,158,11,0.08)]">
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
                <SprintBoatRace
                    tasks={visibleTasksWithLiveActivities}
                    dispatches={execution.taskDispatches}
                    hasLiveSprint={hasSprintContext}
                />
            ) : (
                <SprintDag
                    tasks={visibleTasksWithLiveActivities}
                    dispatches={execution.taskDispatches}
                    hasSprintContext={hasSprintContext}
                />
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
                {(["All", "Running", "Completed", "Failed", "Pending"] as TaskFilter[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-lg
                                   transition-all duration-200 flex items-center gap-2
                                   ${activeFilter === f
                                       ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                                       : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                   }`}
                    >
                        {f}
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md
                            ${activeFilter === f
                                ? "bg-signal-500/[0.12] text-signal-600 dark:text-signal-400"
                                : "bg-black/[0.06] dark:bg-white/[0.06] text-slate-400"
                            }`}>
                            {counts[f]}
                        </span>
                    </button>
                ))}
            </div>

            {/* ── Main Content Grid ───────────────────────────────────── */}
            <div ref={contentRef} className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-16">

                {/* Task cards */}
                <div className="xl:col-span-8 flex flex-col gap-5">
                    {!hasSprintContext ? (
                        <IdleRuntimeState
                            title={pausedIntervention ? "Human Intervention Needed" : "Waiting for Sprint Start"}
                            subtitle={pausedIntervention
                                ? pausedIntervention.instructions
                                : "Launch a sprint to activate live task telemetry, protocol output, and runtime activity for this project."}
                        />
                    ) : filtered.length === 0 ? (
                        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border-2 border-dashed border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-16 text-center">
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
                        filtered.map(task => (
                            <LiveTaskCard
                                key={task.id}
                                task={task}
                                taskTiming={taskTimingMap.get(task.record_id || task.id) || taskTimingMap.get(task.id) || null}
                                events={(task.record_id && taskEventsByRecordId.byRecordId.get(task.record_id))
                                    || taskEventsByRecordId.byTaskKey.get(task.id)
                                    || []}
                                onRerun={handleRerun}
                                isRerunning={rerunningIds.has(task.id)}
                                dispatchError={task.record_id ? dispatchInfoByTaskId.get(task.record_id)?.errorMessage : null}
                                dispatchStartedAt={task.record_id ? dispatchInfoByTaskId.get(task.record_id)?.startedAt : null}
                                dispatchFinishedAt={task.record_id ? dispatchInfoByTaskId.get(task.record_id)?.finishedAt : null}
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
                        fallback={hasSprintContext ? "Waiting for activity..." : "Waiting for sprint to start."}
                    />

                    {/* 2. Git/CI — moved to top, always visible */}
                    <GitCiPanel status={gitStatus} error={gitStatusError} />

                    {/* 3. Execution Runtime — collapsible */}
                    <ExecutionRuntimePanel
                        snapshot={execution}
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
                        collapsible
                        defaultOpen={hasSprintContext}
                    />

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
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(hasSprintContext ? status.instructions : undefined) || '<p class="text-slate-400 dark:text-slate-600 italic">No active sprint protocol.</p>' }}
                        />
                    </CollapsiblePanel>
                </div>
            </div>
        </div>
    );
};
