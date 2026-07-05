import type { FunctionComponent } from "preact";
import { memo, createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
    ChevronRight, Eye, EyeOff,
    FileText, RotateCcw, GitPullRequest, ExternalLink, CheckCheck, PencilLine, Cpu,
} from "lucide-preact";


import { MARKDOWN_PROSE_CLASS } from "./ui/MarkdownEditorField.js";
import { TaskStagePills } from "./SprintStatsDeck.js";
import { RuntimeEventFeed } from "./RuntimeEventFeed.js";
import { renderMarkdown } from "../../lib/markdown.js";
import type { Subtask, ExecutionRuntimeEventSummary, ExecutionInvocationRecord } from "../../types.js";
import {
    MERGE_INDICATOR_CFG,
    getTaskCfg,
} from "../lib/live-session-config.js";
import { getTaskProgressPhase, type TaskProgressPhase } from "../../lib/task-progress.js";
import type { LiveTaskTimingSummary } from "../lib/live-stats.js";
import { RerunTaskModal } from "./ui/RerunTaskModal.js";
import { Button } from "./ui/Button.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { AgentSelectAvatarIcon } from "./agents/AgentSelectAvatarIcon.js";
import { SprintReviewBadge } from "./sprints/SprintReviewBadge.js";
import { getSafeUrl } from "../lib/safe-url.js";
import { LiveTaskInvocationRow } from "./live-session/LiveTaskInvocationRow.js";
import { QuotaCountdown, TaskDuration } from "./live-session/LiveTaskTiming.js";

/* ─── LiveTaskCard ───────────────────────────────────────────────────────── */

export interface RerunOptions {
    provider?: string;
    providerConfigId?: string;
    model?: string;
    clearWorktree?: boolean;
    resetDependents?: boolean;
    undoMerge?: boolean;
}

export interface LiveTaskCardProps {
    task: Subtask;
    allTasks: Subtask[];
    /** Live execution phase resolved from the latest dispatch (e.g. QUOTA while waiting on
     *  a provider quota reset). Falls back to the task's own status when not supplied. */
    phase?: TaskProgressPhase | null;
    taskTiming?: LiveTaskTimingSummary | null;
    events?: ExecutionRuntimeEventSummary[];
    invocations?: ExecutionInvocationRecord[];
    onRerun: (id: string, options?: RerunOptions) => void;
    onEdit: (task: Subtask) => void;
    onForceComplete: (task: Subtask) => void;
    isRerunning: boolean;
    isForceCompleting?: boolean;
    forceCompleteError?: string | null;
    dispatchInfo?: {
        errorMessage: string | null;
        startedAt: string | null;
        finishedAt: string | null;
        status: string | null;
    } | null;
    agentPreset?: { name: string; avatarConfig?: import("../types.js").AgentAvatarConfig } | null;
}

const LiveTaskCard: FunctionComponent<LiveTaskCardProps> = memo(({
    task,
    allTasks,
    phase,
    taskTiming,
    events,
    invocations = [],
    onRerun,
    onEdit,
    onForceComplete,
    isRerunning,
    isForceCompleting = false,
    forceCompleteError = null,
    dispatchInfo,
    agentPreset,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [showFeed, setShowFeed] = useState(false);
    const [showInvocations, setShowInvocations] = useState(false);
    const [showRerunModal, setShowRerunModal] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    const previewRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLDivElement>(null);
    const feedRef = useRef<HTMLDivElement>(null);
    const invocationRef = useRef<HTMLDivElement>(null);
    const chevronRef = useRef<SVGSVGElement>(null);
    const flareRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();
    const isMounted = useRef(false);

    const isPreviewVisible = !expanded && !showFeed && !showInvocations;

    const taskPhase = phase ?? getTaskProgressPhase(task);
    const cfg = getTaskCfg(taskPhase);
    const StatusIcon = cfg.icon;
    const hasEventFeed = Boolean(events && events.length > 0);
    const hasInvocations = invocations.length > 0;
    const mergeCfg = task.merge_indicator ? MERGE_INDICATOR_CFG[task.merge_indicator] : null;
    const sessionLabel = (task.session_id || task.session_name || "").replace(/^sessions\//, "");
    const isForceCompleteUnavailable = taskPhase === "COMPLETED" || isForceCompleting;
    const forceCompleteStatusMessage = isForceCompleting
        ? "Marking this task complete. The live snapshot remains visible while the update is confirmed."
        : taskPhase === "COMPLETED"
            ? "Task is already complete."
            : null;
    const rerunStatusMessage = isRerunning ? "Rerun request is in progress." : null;

    const handleRerunClick = useCallback(() => {
        if (isRerunning) return;
        setShowRerunModal(true);
    }, [isRerunning]);
    const handleEditClick = useCallback(() => onEdit(task), [onEdit, task]);
    const handleForceCompleteClick = useCallback(() => {
        if (isForceCompleteUnavailable) return;
        onForceComplete(task);
    }, [isForceCompleteUnavailable, onForceComplete, task]);

    const handleRerunConfirm = useCallback((options: { provider?: string; providerConfigId?: string; model?: string; clearWorktree: boolean; resetDependents: boolean; undoMerge?: boolean }) => {
        setShowRerunModal(false);
        onRerun(task.record_id || task.id, {
            provider: options.provider,
            providerConfigId: options.providerConfigId,
            model: options.model,
            clearWorktree: options.clearWorktree,
            resetDependents: options.resetDependents,
            undoMerge: options.undoMerge,
        });
    }, [task.id, task.record_id, onRerun]);

    const renderedPrompt = useMemo(() => renderMarkdown(task.prompt), [task.prompt]);
    const dispatchTiming = useMemo(() => ({
        startedAt: dispatchInfo?.startedAt ?? null,
        finishedAt: dispatchInfo?.finishedAt ?? null,
        status: dispatchInfo?.status ?? taskPhase,
    }), [dispatchInfo?.startedAt, dispatchInfo?.finishedAt, dispatchInfo?.status, taskPhase]);

    const handleExpandCollapsed = useCallback(() => setExpanded(true), []);

    const handleToggleFeed = useCallback(() => {
        setShowFeed(prev => !prev);
        setExpanded(false);
        setShowInvocations(false);
    }, []);

    const handleToggleInvocations = useCallback(() => {
        setShowInvocations(prev => !prev);
        setExpanded(false);
        setShowFeed(false);
    }, []);

    const handleToggleExpand = useCallback(() => {
        setExpanded(prev => !prev);
        setShowFeed(false);
        setShowInvocations(false);
    }, []);

    const previousTaskPhase = useRef(taskPhase);

    // Flare effect
    useEffect(() => {
        if (isMounted.current && previousTaskPhase.current !== "COMPLETED" && taskPhase === "COMPLETED" && flareRef.current) {
            if (!prefersReducedMotion) {
                gsap.fromTo(flareRef.current,
                    { scale: 0.9, opacity: 0 },
                    {
                        scale: 1.05,
                        opacity: 0.6,
                        duration: 0.4,
                        ease: "power2.out",
                        onComplete: () => {
                            gsap.to(flareRef.current, {
                                opacity: 0,
                                duration: 0.2,
                                ease: "power2.in",
                                clearProps: "all"
                            });
                        }
                    }
                );
            }
        }
    }, [taskPhase, prefersReducedMotion]);

    // Track previous phase
    useEffect(() => {
        previousTaskPhase.current = taskPhase;
    }, [taskPhase]);

    useLayoutEffect(() => {
        if (!isMounted.current) {
            gsap.set(previewRef.current, { height: isPreviewVisible ? "auto" : 0, opacity: isPreviewVisible ? 1 : 0 });
            gsap.set(promptRef.current, { height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 });
            gsap.set(feedRef.current, { height: showFeed ? "auto" : 0, opacity: showFeed ? 1 : 0 });
            gsap.set(invocationRef.current, { height: showInvocations ? "auto" : 0, opacity: showInvocations ? 1 : 0 });
            gsap.set(chevronRef.current, { rotation: expanded ? 90 : 0 });
            isMounted.current = true;
            return;
        }

        const duration = 0.3;
        const ease = "power2.inOut";

        if (isPreviewVisible) {
            gsap.to(previewRef.current, { height: "auto", opacity: 1, duration, ease });
        } else {
            gsap.to(previewRef.current, { height: 0, opacity: 0, duration, ease });
        }

        if (expanded) {
            gsap.to(promptRef.current, { height: "auto", opacity: 1, duration, ease });
            gsap.to(chevronRef.current, { rotation: 90, duration, ease });
        } else {
            gsap.to(promptRef.current, { height: 0, opacity: 0, duration, ease });
            gsap.to(chevronRef.current, { rotation: 0, duration, ease });
        }

        if (showFeed) {
            gsap.to(feedRef.current, { height: "auto", opacity: 1, duration, ease });
        } else {
            gsap.to(feedRef.current, { height: 0, opacity: 0, duration, ease });
        }

        if (showInvocations) {
            gsap.to(invocationRef.current, { height: "auto", opacity: 1, duration, ease });
        } else {
            gsap.to(invocationRef.current, { height: 0, opacity: 0, duration, ease });
        }
    }, [expanded, showFeed, showInvocations, isPreviewVisible]);

    return (
        <div
            ref={cardRef}
            tabIndex={0}
            className="group relative overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal-500 focus-visible:ring-offset-4 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800
                       bg-white dark:bg-void-800

                       border border-black/[0.08] dark:border-white/[0.08]
                       rounded-[1.75rem] p-7
                       shadow-sm
                       transition-[border-color] duration-300"
        >



            <div
                ref={flareRef}
                className="absolute inset-0 rounded-[1.75rem] pointer-events-none opacity-0 mix-blend-screen"
                style={{ backgroundColor: cfg.hex, filter: 'blur(20px)' }}
            />

            {/* Hover tint */}
            <div className="absolute inset-0 pointer-events-none transition-colors duration-300 group-hover:bg-black/[0.01] dark:group-hover:bg-white/[0.01] group-focus-within:bg-black/[0.01] dark:group-focus-within:bg-white/[0.01]" />

            {/* Ghost ID watermark */}
            <div
                aria-hidden
                className="absolute -right-3 -top-6 font-black font-display
                           text-[7rem] leading-none tracking-tighter
                           text-black/[0.02] dark:text-white/[0.015]
                           pointer-events-none select-none truncate max-w-full"
            >
                #{task.id}
            </div>

            <div className="relative z-10">
                {/* Header row */}
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
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
                                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.14em] ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
                                    <span className="sr-only">Task status: </span>{cfg.label}
                                </span>
                                {mergeCfg && taskPhase !== "RUNNING" && taskPhase !== "PENDING" && (
                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.14em] ${mergeCfg.bg} ${mergeCfg.text} border ${mergeCfg.border}`}>
                                        {mergeCfg.label}
                                    </span>
                                )}
                                {task.latestReview && taskPhase !== "RUNNING" && taskPhase !== "PENDING" && (
                                    <SprintReviewBadge summary={task.latestReview} compact showCompactLabel align="right" />
                                )}
                            </div>
                            <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                                {task.title}
                            </h3>
                        </div>
                    </div>

                    {/* Right meta column */}
                    <div className="flex flex-col items-start sm:items-end gap-2 shrink-0 w-full sm:w-auto">
                        {agentPreset && (
                            <div className="flex items-center gap-1.5">
                                <AgentSelectAvatarIcon avatarConfig={agentPreset.avatarConfig} seed={agentPreset.name} />
                                <span className="text-[9px] font-mono font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 max-w-[80px] truncate">
                                    {agentPreset.name}
                                </span>
                            </div>
                        )}
                        {task.provider && (
                            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.1em] text-slate-300 dark:text-slate-600">
                                {task.provider}
                            </span>
                        )}
                        <TaskDuration
                            taskTiming={taskTiming}
                            dispatchTiming={dispatchTiming}
                        />
                        {(hasEventFeed || task.session_id || task.session_name) && (
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 max-w-[100px] truncate" title={sessionLabel}>
                                {sessionLabel.substring(0, 16)}
                            </span>
                        )}
                    </div>
                </div>

                <TaskStagePills timing={taskTiming} />

                {/* Prompt preview — collapsed */}
                <div ref={previewRef} className="overflow-hidden">
                    <button
                        type="button"
                        onClick={handleExpandCollapsed}
                        className="text-[13px] text-slate-400 dark:text-slate-500 line-clamp-1 text-left w-full hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200 mb-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 focus-visible:rounded"
                    >
                        {task.prompt.substring(0, 140)}...
                    </button>
                </div>

                {/* Expanded prompt */}
                <div ref={promptRef} className="overflow-hidden">
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex items-center gap-2 mb-3">
                            <FileText className="w-3 h-3 text-slate-400" strokeWidth={2} />
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Task Prompt</span>
                        </div>
                        <div
                            className={`${MARKDOWN_PROSE_CLASS}
                                       prose-code:px-1.5
                                       prose-a:focus-visible:outline-none prose-a:focus-visible:ring-2 prose-a:focus-visible:ring-signal-500 prose-a:focus-visible:rounded prose-a:focus-visible:ring-offset-1 dark:prose-a:focus-visible:ring-offset-void-800
                                       font-mono text-[12px] leading-relaxed`}
                            dangerouslySetInnerHTML={{ __html: renderedPrompt }}
                        />
                    </div>
                </div>

                {/* Task invocation feed */}
                <div ref={invocationRef} className="overflow-hidden">
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Cpu className="w-3.5 h-3.5 text-signal-500" strokeWidth={2} />
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Task Invocations</span>
                            </div>
                            <span className="text-[9px] font-mono text-slate-400">{invocations.length} total</span>
                        </div>
                        <div
                            role="log"
                            aria-label={`Invocation feed for task ${task.id}`}
                            aria-live="polite"
                            aria-relevant="additions text"
                            className="max-h-80 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar"
                        >
                            {invocations.map((invocation) => (
                                <LiveTaskInvocationRow key={invocation.id} invocation={invocation} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Live session feed */}
                <div ref={feedRef} className="overflow-hidden">
                    <div className="mb-5 p-5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 motion-safe:animate-pulse motion-reduce:ring-2 motion-reduce:ring-signal-500/25" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Runtime Feed</span>
                        </div>
                        <RuntimeEventFeed events={events} />
                    </div>
                </div>

                {/* Dispatch error / quota countdown */}
                {dispatchInfo?.errorMessage && (
                    <div role="alert" className="mb-4 rounded-xl border border-status-amber/15 bg-status-amber/[0.04] px-4 py-2.5">
                        <QuotaCountdown errorMessage={dispatchInfo.errorMessage} />
                    </div>
                )}
                {forceCompleteError && (
                    <div role="alert" className="mb-4 rounded-xl border border-status-red/20 bg-status-red/[0.06] px-4 py-2.5 text-xs text-status-red">
                        {forceCompleteError}
                    </div>
                )}
                {(forceCompleteStatusMessage || rerunStatusMessage) && (
                    <div role="status" aria-live="polite" aria-busy={isForceCompleting || isRerunning} className="mb-4 rounded-xl border border-signal-500/15 bg-signal-500/[0.05] px-4 py-2.5 text-xs text-signal-700 dark:text-signal-300">
                        {forceCompleteStatusMessage || rerunStatusMessage}
                    </div>
                )}

                {/* Action bar */}
                <div className={`flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-black/[0.04] dark:border-white/[0.04] transition-opacity duration-200 ${expanded || showFeed || showInvocations ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                        {hasInvocations && (
                            <button
                                type="button"
                                onClick={handleToggleInvocations}
                                aria-label={`${showInvocations ? 'Hide' : 'Show'} invocation feed for task ${task.id}`}
                                className={`flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800
                                           transition-all duration-200 border
                                           ${showInvocations
                                               ? 'bg-signal-500/10 text-signal-500 border-signal-500/20 shadow-[0_0_12px_rgba(0,224,160,0.08)]'
                                               : 'bg-black/[0.03] dark:bg-white/[0.03] text-slate-400 border-transparent hover:text-signal-500 hover:border-signal-500/15'
                                           }`}
                            >
                                {showInvocations ? <EyeOff className="w-3 h-3" strokeWidth={2} /> : <Cpu className="w-3 h-3" strokeWidth={2} />}
                                {showInvocations ? "Hide Invocations" : `Invocations ${invocations.length}`}
                            </button>
                        )}
                        {hasEventFeed && (
                            <button
                                type="button"
                                onClick={handleToggleFeed}
                                aria-label={`${showFeed ? 'Hide' : 'Show'} runtime feed for task ${task.id}`}
                                className={`flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800
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
                            onClick={handleToggleExpand}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} prompt for task ${task.id}`}
                            className={`flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800
                                       transition-all duration-200 border
                                       ${expanded
                                           ? 'bg-ember-500/10 text-ember-500 border-ember-500/20'
                                           : 'bg-black/[0.03] dark:bg-white/[0.03] text-slate-400 border-transparent hover:text-ember-500 hover:border-ember-500/15'
                                       }`}
                        >
                            <ChevronRight ref={chevronRef} className="w-3 h-3" strokeWidth={2.5} />
                            Prompt
                        </button>
                        <Button
                            type="button"
                            onClick={handleEditClick}
                            aria-label={`Edit task ${task.id}`}
                            variant="ghost"
                            icon={PencilLine}
                            className="px-3 py-2.5 min-h-[44px] text-[10px] uppercase tracking-[0.1em] hover:text-signal-500 hover:border-signal-500/15 disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800"
                        >
                            Edit
                        </Button>
                        <Button
                            type="button"
                            onClick={handleForceCompleteClick}
                            aria-label={`Force complete task ${task.id}`}
                            isLoading={isForceCompleting}
                            aria-disabled={isForceCompleteUnavailable}
                            aria-busy={isForceCompleting}
                            title={forceCompleteStatusMessage ?? "Force complete task"}
                            variant="ghost"
                            icon={CheckCheck}
                            className="px-3 py-2.5 min-h-[44px] text-[10px] uppercase tracking-[0.1em] hover:text-status-green hover:border-status-green/15 disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 aria-disabled:opacity-40 aria-disabled:pointer-events-none"
                        >
                            {isForceCompleting ? "Force completing" : "Force complete"}
                            {forceCompleteStatusMessage && <span className="sr-only">{forceCompleteStatusMessage}</span>}
                        </Button>
                        <Button
                            type="button"
                            onClick={handleRerunClick}
                            aria-label={`Rerun task ${task.id}`}
                            isLoading={isRerunning}
                            aria-busy={isRerunning}
                            title={rerunStatusMessage ?? "Rerun task"}
                            variant="ghost"
                            icon={RotateCcw}
                            className="px-3 py-2.5 min-h-[44px] text-[10px] uppercase tracking-[0.1em] hover:text-status-amber hover:border-status-amber/15 disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800"
                        >
                            {isRerunning ? "Rerunning" : "Rerun"}
                            {rerunStatusMessage && <span className="sr-only">{rerunStatusMessage}</span>}
                        </Button>
                    </div>
                    {task.pr_url && (
                        <a
                            href={getSafeUrl(task.pr_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`View Pull Request for task ${task.id}`}
                            className="text-[10px] font-mono text-signal-500 hover:text-signal-400 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 focus-visible:rounded"
                        >
                            <span className="py-2.5 min-h-[44px] inline-flex items-center gap-1.5">
                                <GitPullRequest className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                                <span className="sr-only">Pull Request</span>
                                <span aria-hidden="true">PR</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-50" strokeWidth={2} />
                            </span>
                        </a>
                    )}
                </div>
            </div>

            {showRerunModal && createPortal(
                <RerunTaskModal
                    task={task}
                    allTasks={allTasks}
                    currentProvider={task.provider}
                    onClose={() => setShowRerunModal(false)}
                    onConfirm={handleRerunConfirm}
                />,
                document.body,
            )}
        </div>
    );
});

export { LiveTaskCard, QuotaCountdown, TaskDuration };
