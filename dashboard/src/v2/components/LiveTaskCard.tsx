import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
    Clock, ChevronDown, ChevronRight, Eye, EyeOff,
    FileText, RotateCcw, GitPullRequest, ExternalLink, Timer,
} from "lucide-preact";
import { WaveFluid } from "./ui/WaveFluid.js";
import { BorderTrace } from "./ui/BorderTrace.js";
import { TaskStagePills } from "./SprintStatsDeck.js";
import { RuntimeEventFeed } from "./RuntimeEventFeed.js";
import { formatTime } from "../../lib/time.js";
import { renderMarkdown } from "../../lib/markdown.js";
import type { Subtask, ExecutionRuntimeEventSummary } from "../../types.js";
import {
    MERGE_INDICATOR_CFG,
    getTaskCfg,
} from "../lib/live-session-config.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";
import type { LiveTaskTimingSummary } from "../lib/live-stats.js";

/* ─── Helpers ────────────────────────────────────────────────────────────── */

export function formatDuration(totalSeconds: number): string {
    if (totalSeconds <= 0) return "0s";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function extractRetryAfterIso(errorMessage: string): string | null {
    const match = errorMessage.match(/\[RETRY_AFTER:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
    return match?.[1] ?? null;
}

export const QuotaCountdown: FunctionComponent<{ errorMessage: string }> = ({ errorMessage }) => {
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

export const TaskDuration: FunctionComponent<{ startedAt: string | null; finishedAt: string | null; status: string }> = ({ startedAt, finishedAt, status }) => {
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

/* ─── LiveTaskCard ───────────────────────────────────────────────────────── */

export interface LiveTaskCardProps {
    task: Subtask;
    taskTiming?: LiveTaskTimingSummary | null;
    events?: ExecutionRuntimeEventSummary[];
    onRerun: (id: string) => void;
    isRerunning: boolean;
    dispatchError?: string | null;
    dispatchStartedAt?: string | null;
    dispatchFinishedAt?: string | null;
}

const LiveTaskCard: FunctionComponent<LiveTaskCardProps> = memo(({
    task,
    taskTiming,
    events,
    onRerun,
    isRerunning,
    dispatchError,
    dispatchStartedAt,
    dispatchFinishedAt,
}) => {
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
});

export { LiveTaskCard };
