import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
    Zap, GitBranch, Clock, CheckCircle2, XCircle, AlertTriangle,
    Activity, ChevronDown, ChevronRight, Radio, Terminal, RefreshCw,
    GitPullRequest, GitMerge, CircleDot, ExternalLink, Eye, EyeOff,
    Play, FileText, RotateCcw, Layers,
} from "lucide-preact";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { rerunTask } from "../lib/api/dashboard-api.js";
import { getActivityText } from "../lib/activity.js";
import { formatTime } from "../lib/time.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask, JulesActivity, GitTrackingStatus, DashboardStats } from "../types.js";

/* ─── Status Maps ────────────────────────────────────────────────────────── */

const TASK_STATUS_CFG = {
    RUNNING:   { label: "Running",   hex: "#00E0A0", dot: "bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse", text: "text-signal-500",  bg: "bg-signal-500/8",  border: "border-signal-500/20", icon: Activity },
    COMPLETED: { label: "Completed", hex: "#00AB84", dot: "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.5)]",                text: "text-status-green", bg: "bg-status-green/8", border: "border-status-green/20", icon: CheckCircle2 },
    FAILED:    { label: "Failed",    hex: "#E3000F", dot: "bg-status-red shadow-[0_0_10px_rgba(227,0,15,0.7)]",                  text: "text-status-red",   bg: "bg-status-red/8",   border: "border-status-red/20", icon: XCircle },
    BLOCKED:   { label: "Blocked",   hex: "#F59E0B", dot: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)]",               text: "text-status-amber", bg: "bg-status-amber/8", border: "border-status-amber/20", icon: AlertTriangle },
    PENDING:   { label: "Pending",   hex: "#64748b", dot: "bg-slate-400 dark:bg-slate-600",                                      text: "text-slate-400",    bg: "bg-slate-500/8",    border: "border-slate-500/20", icon: Clock },
} as const;

type TaskStatusKey = keyof typeof TASK_STATUS_CFG;

const getTaskCfg = (status?: string) => TASK_STATUS_CFG[(status as TaskStatusKey) ?? "PENDING"] ?? TASK_STATUS_CFG.PENDING;

const MERGE_INDICATOR_CFG: Record<string, { label: string; text: string; bg: string; border: string }> = {
    CI:            { label: "CI",            text: "text-signal-400",     bg: "bg-signal-500/8",      border: "border-signal-500/15" },
    AUTOMERGE:     { label: "Automerge",     text: "text-ember-400",      bg: "bg-ember-500/8",       border: "border-ember-500/15" },
    MERGED:        { label: "Merged",        text: "text-status-green",   bg: "bg-status-green/8",    border: "border-status-green/15" },
    MERGE_BLOCKED: { label: "Merge Blocked", text: "text-status-amber",   bg: "bg-status-amber/8",    border: "border-status-amber/15" },
};

const ORIGINATOR_CFG: Record<string, { border: string; text: string; label: string }> = {
    agent:    { border: "border-signal-500/30", text: "text-signal-400", label: "Agent" },
    user:     { border: "border-ember-500/30",  text: "text-ember-400",  label: "User" },
    provider: { border: "border-status-amber/30", text: "text-status-amber", label: "Provider" },
    system:   { border: "border-white/[0.06]",  text: "text-slate-500",  label: "System" },
};

const getOriginatorCfg = (originator?: string) => {
    const key = (originator || "system").toLowerCase();
    return ORIGINATOR_CFG[key] ?? ORIGINATOR_CFG.system;
};

/* ─── Stat Metric ────────────────────────────────────────────────────────── */

const StatMetric: FunctionComponent<{
    label: string;
    value: number;
    accentHex: string;
    icon: any;
    delay?: number;
}> = ({ label, value, accentHex, icon: Icon, delay = 0 }) => {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (ref.current) {
            gsap.fromTo(ref.current,
                { opacity: 0, y: 30, scale: 0.95 },
                { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "power3.out", delay },
            );
        }
    }, [delay]);

    return (
        <div
            ref={ref}
            className="group relative overflow-hidden
                       bg-white/70 dark:bg-void-800/60
                       backdrop-blur-2xl
                       border border-black/[0.06] dark:border-white/[0.06]
                       rounded-[1.75rem] p-6
                       shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
        >
            <WaveFluid accentHex={accentHex} />
            <BorderTrace accentHex={accentHex} />

            <div className="relative z-10 flex items-center gap-4">
                <div
                    className="w-10 h-10 rounded-[0.875rem] flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${accentHex}14` }}
                >
                    <span style={{ color: accentHex }}><Icon className="w-5 h-5" strokeWidth={1.5} /></span>
                </div>
                <div>
                    <span className="text-[2rem] font-black font-mono tracking-tighter text-slate-900 dark:text-white leading-none">
                        {value}
                    </span>
                    <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1">
                        {label}
                    </span>
                </div>
            </div>
        </div>
    );
};

/* ─── Live Activity Feed ─────────────────────────────────────────────────── */

const LiveActivityFeed: FunctionComponent<{ activities?: JulesActivity[] }> = ({ activities }) => {
    const feedRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = feedRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) {
            el.scrollTop = el.scrollHeight;
        }
    }, [activities]);

    if (!activities || activities.length === 0) {
        return (
            <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-600">
                <div className="text-center">
                    <Terminal className="w-6 h-6 mx-auto mb-3 opacity-40" strokeWidth={1} />
                    <p className="text-xs font-mono">Awaiting session data...</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="max-h-64 overflow-y-auto pr-2 dashboard-scrollbar space-y-1">
            {activities.map((activity) => {
                const cfg = getOriginatorCfg(activity.originator);
                return (
                    <div key={activity.id} className={`flex gap-3 border-l-2 ${cfg.border} pl-3 py-2 group/entry hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded-r-lg transition-colors duration-200`}>
                        <div className="flex-grow min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${cfg.text}`}>
                                    {cfg.label}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono">
                                    {formatTime(activity.createTime)}
                                </span>
                            </div>
                            <div className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed font-mono line-clamp-2 group-hover/entry:line-clamp-none transition-all cursor-default">
                                {getActivityText(activity)}
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
    onRerun: (id: string) => void;
    isRerunning: boolean;
}> = ({ task, onRerun, isRerunning }) => {
    const [expanded, setExpanded] = useState(false);
    const [showFeed, setShowFeed] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const cfg = getTaskCfg(task.status);
    const StatusIcon = cfg.icon;
    const hasSession = Boolean(task.session_id || task.session_name);
    const mergeCfg = task.merge_indicator ? MERGE_INDICATOR_CFG[task.merge_indicator] : null;
    const sessionLabel = (task.session_id || task.session_name || "").replace(/^sessions\//, "");

    const handleRerun = () => {
        const confirmed = window.confirm(`Rerun task "${task.id}"?\n\nThis resets the task state and discards current progress.`);
        if (confirmed) onRerun(task.id);
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
                        {hasSession && (
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 max-w-[100px] truncate" title={sessionLabel}>
                                {sessionLabel.substring(0, 16)}
                            </span>
                        )}
                    </div>
                </div>

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
                {showFeed && hasSession && (
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Live Session Feed</span>
                        </div>
                        <LiveActivityFeed activities={task.activities} />
                    </div>
                )}

                {/* Action bar */}
                <div className="flex items-center justify-between pt-4 border-t border-black/[0.04] dark:border-white/[0.04]">
                    <div className="flex items-center gap-2">
                        {hasSession && (
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
                                {showFeed ? "Hide Feed" : "Live Feed"}
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
    if (n === "IN_PROGRESS" || n === "QUEUED" || n === "PENDING") return "text-status-amber";
    if (n === "FAILURE" || n === "FAILED" || n === "ERROR") return "text-status-red";
    return "text-slate-400";
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

const IntelPanel: FunctionComponent<{
    title: string;
    icon: any;
    accentHex: string;
    content?: string;
    fallback: string;
}> = ({ title, icon: Icon, accentHex, content, fallback }) => (
    <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <WaveFluid accentHex={accentHex} />
        <BorderTrace accentHex={accentHex} />

        <div className="relative z-10">
            <div className="flex items-center gap-2.5 mb-5">
                <span style={{ color: accentHex }}><Icon className="w-4 h-4" strokeWidth={1.5} /></span>
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{title}</span>
            </div>
            <div
                className="prose prose-sm max-w-none text-slate-600 dark:text-slate-400
                           prose-headings:text-slate-800 dark:prose-headings:text-slate-200
                           prose-code:text-signal-600 dark:prose-code:text-signal-400
                           prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md
                           font-mono text-[12px] leading-relaxed max-h-64 overflow-y-auto dashboard-scrollbar"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) || `<p class="text-slate-400 dark:text-slate-600 italic">${fallback}</p>` }}
            />
        </div>
    </div>
);

/* ─── Filter Type ────────────────────────────────────────────────────────── */

type TaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

const FILTER_STATUS_MAP: Record<TaskFilter, string | null> = {
    All: null, Running: "RUNNING", Completed: "COMPLETED", Failed: "FAILED", Pending: "PENDING",
};

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export const LiveSessionPage: FunctionComponent = () => {
    const headerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const { error, gitStatus, gitStatusError, refreshRuntimeStatus, refreshGitStatus, status, stats, tasksWithLiveActivities } = useDashboardRuntimeData();
    const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set());
    const [activeFilter, setFilter] = useState<TaskFilter>("All");

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

    const handleRerun = useCallback(async (taskId: string) => {
        setRerunningIds(prev => new Set(prev).add(taskId));
        try {
            await rerunTask(taskId);
            await refreshRuntimeStatus();
            await refreshGitStatus();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to rerun task.";
            window.alert(message);
        } finally {
            setRerunningIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
        }
    }, [refreshRuntimeStatus, refreshGitStatus]);

    const filtered = useMemo(() => {
        if (activeFilter === "All") return tasksWithLiveActivities;
        const target = FILTER_STATUS_MAP[activeFilter];
        return tasksWithLiveActivities.filter(t => t.status === target);
    }, [tasksWithLiveActivities, activeFilter]);

    const counts: Record<TaskFilter, number> = useMemo(() => ({
        All:       tasksWithLiveActivities.length,
        Running:   stats.running,
        Completed: stats.completed,
        Failed:    stats.failed,
        Pending:   tasksWithLiveActivities.filter(t => t.status === "PENDING" || t.status === "BLOCKED").length,
    }), [tasksWithLiveActivities, stats]);

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
                        {status.sprint_number != null && (
                            <span className="text-slate-400 ml-1">· Sprint {status.sprint_number}</span>
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
                        {status.feature_branch
                            ? <>Monitoring <span className="font-mono text-signal-600 dark:text-signal-400">{status.feature_branch}</span> in real-time.</>
                            : "Awaiting orchestration. Tasks will appear as the sprint begins."
                        }
                    </p>
                </div>

                {/* Right: pills + timestamp */}
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full
                                       bg-signal-500/8 dark:bg-signal-500/10
                                       text-signal-600 dark:text-signal-400
                                       border border-signal-500/15 dark:border-signal-500/20
                                       flex items-center gap-2.5
                                       shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-md">
                            <span className="w-2 h-2 rounded-full bg-signal-500 relative">
                                <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />
                            </span>
                            {stats.running} Running
                        </div>
                        {stats.failed > 0 && (
                            <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full
                                           bg-status-red/8 text-status-red border border-status-red/15
                                           flex items-center gap-2.5 backdrop-blur-md">
                                <span className="w-2 h-2 rounded-full bg-status-red relative">
                                    <span className="absolute inset-0 rounded-full animate-ping bg-status-red opacity-50" />
                                </span>
                                {stats.failed} Failed
                            </div>
                        )}
                    </div>
                    {status.timestamp && (
                        <span className="text-[10px] font-mono text-slate-400">
                            Updated {formatTime(status.timestamp)}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Stats Row ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
                <StatMetric label="Total"        value={stats.total}        accentHex="#00E0A0" icon={Layers}        delay={0.1} />
                <StatMetric label="Running"      value={stats.running}      accentHex="#00E0A0" icon={Activity}      delay={0.15} />
                <StatMetric label="Completed"    value={stats.completed}    accentHex="#00AB84" icon={CheckCircle2}  delay={0.2} />
                <StatMetric label="Failed"       value={stats.failed}       accentHex="#E3000F" icon={XCircle}       delay={0.25} />
                <StatMetric label="CI"           value={stats.ci}           accentHex="#00E0A0" icon={CircleDot}     delay={0.3} />
                <StatMetric label="Automerge"    value={stats.automerge}    accentHex="#FFB800" icon={GitMerge}      delay={0.35} />
                <StatMetric label="Merged"       value={stats.merged}       accentHex="#00AB84" icon={GitPullRequest} delay={0.4} />
                <StatMetric label="Blocked"      value={stats.mergeBlocked} accentHex="#F59E0B" icon={AlertTriangle} delay={0.45} />
            </div>

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
                    {filtered.length === 0 ? (
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
                                onRerun={handleRerun}
                                isRerunning={rerunningIds.has(task.id)}
                            />
                        ))
                    )}
                </div>

                {/* Sidebar — Intelligence + Git */}
                <div className="xl:col-span-4 flex flex-col gap-6">
                    <IntelPanel
                        title="Latest Activity"
                        icon={Activity}
                        accentHex="#00E0A0"
                        content={status.reportText}
                        fallback="Waiting for activity..."
                    />
                    <IntelPanel
                        title="Protocol"
                        icon={AlertTriangle}
                        accentHex="#FFB800"
                        content={status.instructions}
                        fallback="Orchestration optimal. No manual intervention needed."
                    />
                    <GitCiPanel status={gitStatus} error={gitStatusError} />
                </div>
            </div>
        </div>
    );
};
