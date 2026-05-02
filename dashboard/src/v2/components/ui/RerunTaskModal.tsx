import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, GitBranch, RotateCcw, Trash2, X } from "lucide-preact";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import type { Subtask } from "../../../types.js";

const PROVIDER_OPTIONS = [
    { value: "", label: "Auto (use current setting)" },
    { value: "jules", label: "Jules" },
    { value: "gemini", label: "Gemini" },
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex" },
] as const;

interface RerunTaskModalProps {
    task: Subtask;
    allTasks: Subtask[];
    currentProvider?: string | null;
    onClose: () => void;
    onConfirm: (options: { provider?: string; clearWorktree: boolean; resetDependents: boolean }) => void | Promise<void>;
}

const MERGED_TASK_INDICATORS = new Set(["MERGED", "AUTOMERGE"]);
const DOWNSTREAM_RESET_PROMPT_STATUSES = new Set(["RUNNING", "CODING_COMPLETED", "COMPLETED", "FAILED"]);

export const RerunTaskModal: FunctionComponent<RerunTaskModalProps> = ({
    task,
    allTasks,
    currentProvider,
    onClose,
    onConfirm,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const [provider, setProvider] = useState("");
    const [clearWorktree, setClearWorktree] = useState(false);
    const [resetDependents, setResetDependents] = useState(false);

    const reducedMotion = useReducedMotion();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const downstreamTasks = useMemo(() => {
        const byId = new Map(allTasks.map(candidate => [candidate.id, candidate]));
        const visited = new Set<string>();
        const queue = allTasks
            .filter(candidate => candidate.depends_on.includes(task.id))
            .map(candidate => candidate.id);
        const result: Subtask[] = [];

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId || visited.has(currentId)) {
                continue;
            }
            visited.add(currentId);
            const currentTask = byId.get(currentId);
            if (!currentTask) {
                continue;
            }
            result.push(currentTask);
            for (const candidate of allTasks) {
                if (!visited.has(candidate.id) && candidate.depends_on.includes(currentId)) {
                    queue.push(candidate.id);
                }
            }
        }

        return result;
    }, [allTasks, task.id]);

    const downstreamPromptTasks = useMemo(
        () => downstreamTasks.filter(candidate => DOWNSTREAM_RESET_PROMPT_STATUSES.has(candidate.status || "PENDING")),
        [downstreamTasks],
    );
    const mergedTaskCount = useMemo(() => (
        [task, ...downstreamTasks].filter(candidate => (
            Boolean(candidate.is_merged) || MERGED_TASK_INDICATORS.has(candidate.merge_indicator || "")
        )).length
    ), [downstreamTasks, task]);
    const taskAlreadyMerged = Boolean(task.is_merged) || MERGED_TASK_INDICATORS.has(task.merge_indicator || "");

    useLayoutEffect(() => {
        const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
        const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
        gsap.fromTo(cardRef.current,
            { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart },
            { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, duration: d_card, ease: MODAL_MOTION.entry.ease, delay: reducedMotion ? 0 : 0.04 },
        );
    }, [reducedMotion]);

    const handleClose = () => {
        if (isSubmitting) return;
        const duration = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, duration, ease: MODAL_MOTION.exit.ease });
        gsap.to(backdropRef.current, { opacity: 0, duration, delay: reducedMotion ? 0 : 0.04, onComplete: onClose });
    };

    const backdropRef = useFocusTrap(true, { onClose: handleClose, restoreFocus: true });

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm({
                provider: provider || undefined,
                clearWorktree,
                resetDependents,
            });
            setIsSubmitting(false);
            handleClose();
        } catch (err) {
            setIsSubmitting(false);
            throw err;
        }
    };

    return (
        <div
            ref={backdropRef}
            onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
            className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50 px-6 py-8 backdrop-blur-md dark:bg-black/70"
        >
            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="rerun-modal-title"
                className="w-full max-w-md rounded-[2rem] bg-white shadow-[0_32px_80px_rgba(0,0,0,0.18)] dark:bg-void-900 dark:shadow-[0_32px_80px_rgba(0,0,0,0.6)] overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-7 pt-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-status-amber/10">
                            <RotateCcw className="w-4 h-4 text-status-amber" strokeWidth={2} />
                        </div>
                        <div>
                            <h2 id="rerun-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                                Rerun Task
                            </h2>
                            <p className="text-[11px] text-slate-400 font-mono">#{task.id}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 hover:text-slate-700 dark:bg-white/[0.04] dark:text-slate-500 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                    >
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-7 pb-6 space-y-5">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        This will reset <span className="font-semibold text-slate-700 dark:text-slate-200">{task.title}</span> and start a fresh execution.
                    </p>

                    {taskAlreadyMerged && (
                        <div className="rounded-2xl border border-status-red/20 bg-status-red/5 px-4 py-3">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 text-status-red shrink-0" strokeWidth={2} />
                                <div className="space-y-1">
                                    <p className="text-[12px] font-semibold text-status-red">
                                        This task already merged code.
                                    </p>
                                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                        Undo the merged changes before rerunning or the new run will build on code that already landed.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Provider selector */}
                    <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400" htmlFor="rerun-provider">
                            Provider
                        </label>
                        <select
                            id="rerun-provider"
                            value={provider}
                            onChange={(e) => setProvider((e.target as HTMLSelectElement).value)}
                            disabled={isSubmitting}
                            className="w-full rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber focus:border-transparent transition-shadow disabled:opacity-50"
                        >
                            {PROVIDER_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        {currentProvider && (
                            <p className="text-[10px] text-slate-400">
                                Current provider: <span className="font-mono font-bold">{currentProvider}</span>
                            </p>
                        )}
                    </div>

                    {downstreamTasks.length > 0 && (
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={resetDependents}
                                onChange={(e) => setResetDependents((e.target as HTMLInputElement).checked)}
                                disabled={isSubmitting}
                                className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-status-amber focus-visible:ring-2 focus-visible:ring-status-amber focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                            />
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <GitBranch className="w-3 h-3 text-slate-400 group-hover:text-status-amber transition-colors" strokeWidth={2} />
                                    <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                        Reset downstream tasks
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                    Clear {downstreamTasks.length} dependent task{downstreamTasks.length === 1 ? "" : "s"} so the rerun starts from a clean dependency chain.
                                </p>
                                {downstreamPromptTasks.length > 0 && (
                                    <p className="text-[11px] text-status-amber mt-1 leading-snug">
                                        {downstreamPromptTasks.length} downstream task{downstreamPromptTasks.length === 1 ? "" : "s"} already started or finished and should usually be reset as well.
                                    </p>
                                )}
                                {mergedTaskCount > 1 && resetDependents && (
                                    <p className="text-[11px] text-status-red mt-1 leading-snug">
                                        Some selected downstream work already merged. Undo those landed changes before rerunning the chain.
                                    </p>
                                )}
                            </div>
                        </label>
                    )}

                    {/* Clear worktree checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={clearWorktree}
                            onChange={(e) => setClearWorktree((e.target as HTMLInputElement).checked)}
                            disabled={isSubmitting}
                            className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-status-amber focus-visible:ring-2 focus-visible:ring-status-amber focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                        />
                        <div>
                            <div className="flex items-center gap-1.5">
                                <Trash2 className="w-3 h-3 text-slate-400 group-hover:text-status-amber transition-colors" strokeWidth={2} />
                                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                    Clear worktree
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                Remove the existing worktree directory before rerunning. Use this for a completely fresh start.
                            </p>
                        </div>
                    </label>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-7 py-4 border-t border-black/[0.05] dark:border-white/[0.05] bg-black/[0.01] dark:bg-white/[0.01]">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 rounded-xl text-[12px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-status-amber text-white shadow-[0_4px_16px_rgba(245,158,11,0.25)] hover:shadow-[0_6px_24px_rgba(245,158,11,0.35)] hover:-translate-y-px transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                        {isSubmitting ? "Rerunning..." : "Rerun Task"}
                    </button>
                </div>
            </div>
        </div>
    );
};
