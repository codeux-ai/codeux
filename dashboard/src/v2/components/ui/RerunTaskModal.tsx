import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, RotateCcw, Trash2 } from "lucide-preact";

const PROVIDER_OPTIONS = [
    { value: "", label: "Auto (use current setting)" },
    { value: "jules", label: "Jules" },
    { value: "gemini", label: "Gemini" },
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex" },
] as const;

interface RerunTaskModalProps {
    taskId: string;
    taskTitle: string;
    currentProvider?: string | null;
    onClose: () => void;
    onConfirm: (options: { provider?: string; clearWorktree: boolean }) => void;
}

export const RerunTaskModal: FunctionComponent<RerunTaskModalProps> = ({
    taskId,
    taskTitle,
    currentProvider,
    onClose,
    onConfirm,
}) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const [provider, setProvider] = useState("");
    const [clearWorktree, setClearWorktree] = useState(false);

    useLayoutEffect(() => {
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
        gsap.fromTo(cardRef.current,
            { y: 36, opacity: 0, scale: 0.96 },
            { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power4.out", delay: 0.04 },
        );
    }, []);

    const handleClose = () => {
        gsap.to(cardRef.current, { y: 18, opacity: 0, scale: 0.97, duration: 0.22, ease: "power3.in" });
        gsap.to(backdropRef.current, { opacity: 0, duration: 0.22, delay: 0.04, onComplete: onClose });
    };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);

    const handleSubmit = () => {
        onConfirm({
            provider: provider || undefined,
            clearWorktree,
        });
        handleClose();
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
                            <p className="text-[11px] text-slate-400 font-mono">#{taskId}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 hover:text-slate-700 dark:bg-white/[0.04] dark:text-slate-500 dark:hover:text-white transition-colors"
                    >
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-7 pb-6 space-y-5">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        This will reset <span className="font-semibold text-slate-700 dark:text-slate-200">{taskTitle}</span> and start a fresh execution.
                    </p>

                    {/* Provider selector */}
                    <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400" htmlFor="rerun-provider">
                            Provider
                        </label>
                        <select
                            id="rerun-provider"
                            value={provider}
                            onChange={(e) => setProvider((e.target as HTMLSelectElement).value)}
                            className="w-full rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-signal-500 focus:border-transparent transition-shadow"
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

                    {/* Clear worktree checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={clearWorktree}
                            onChange={(e) => setClearWorktree((e.target as HTMLInputElement).checked)}
                            className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-signal-500 focus:ring-offset-0 cursor-pointer"
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
                        className="px-4 py-2 rounded-xl text-[12px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-status-amber text-white shadow-[0_4px_16px_rgba(245,158,11,0.25)] hover:shadow-[0_6px_24px_rgba(245,158,11,0.35)] hover:-translate-y-px transition-all duration-200"
                    >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                        Rerun Task
                    </button>
                </div>
            </div>
        </div>
    );
};
