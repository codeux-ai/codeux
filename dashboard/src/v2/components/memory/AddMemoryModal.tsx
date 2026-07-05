import { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { createMemory } from "../../lib/memory-api.js";
import type { MemoryScope, MemoryCategory } from "../../memory-types.js";
import { FieldWrapper } from "../forms/FieldWrapper.js";
import { CheckCircle2, Loader2 } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/index.js";

const CATEGORIES: MemoryCategory[] = ["architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning"];

export const AddMemoryModal: FunctionComponent<{
    open: boolean;
    scope: MemoryScope;
    projectId: string;
    onClose: () => void;
    onCreated: () => void;
}> = ({ open, scope, projectId, onClose, onCreated }) => {
    const [content, setContent] = useState("");
    const [category, setCategory] = useState<MemoryCategory>("context");
    const [strength, setStrength] = useState(0.7);
    const [saving, setSaving] = useState(false);
    const [showError, setShowError] = useState(false);
    const [feedback, setFeedback] = useState<{ status: "idle" | "success" | "error"; message: string | null }>({ status: "idle", message: null });
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const closeTimerRef = useRef<number | null>(null);
    const interactionTokens = useInteractionTokens();

    useEffect(() => {
        if (!open) {
            return;
        }

        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        window.setTimeout(() => {
            contentRef.current?.focus({ preventScroll: true });
        }, 0);

        return () => {
            if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, [open]);

    if (!open) return null;

    const restoreFocus = () => {
        const opener = openerRef.current;
        if (opener && document.contains(opener) && !opener.hasAttribute("disabled") && opener.getAttribute("aria-hidden") !== "true") {
            opener.focus({ preventScroll: true });
        }
    };

    const closeModal = () => {
        if (saving) {
            return;
        }
        restoreFocus();
        onClose();
    };

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        if (!content.trim()) {
            setShowError(true);
            setFeedback({ status: "error", message: "Add a memory description before submitting." });
            contentRef.current?.focus({ preventScroll: true });
            return;
        }
        setSaving(true);
        setFeedback({ status: "idle", message: null });
        try {
            await createMemory(projectId, { scope, content: content.trim(), category, strength });
            setContent("");
            setShowError(false);
            setFeedback({ status: "success", message: "Memory added. Refreshing the workspace." });
            await onCreated();
            closeTimerRef.current = window.setTimeout(() => {
                closeTimerRef.current = null;
                restoreFocus();
                onClose();
            }, 450);
        } catch (error) {
            setFeedback({
                status: "error",
                message: error instanceof Error ? error.message : "Failed to add memory. Check the content and try again."
            });
        } finally {
            setSaving(false);
        }
    };

    const contentInvalid = showError && !content.trim();
    const feedbackIsError = feedback.status === "error";
    const describedBy = "add-memory-status";

    return (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    closeModal();
                }
            }}>
            <form
                className="w-full max-w-md cursor-default bg-white dark:bg-void-800 rounded-[1.5rem] p-6 flex flex-col gap-4
                           border border-black/[0.06] dark:border-white/[0.06]
                           shadow-[0_24px_80px_rgba(0,0,0,0.15)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] max-h-[calc(100dvh-2rem)] overflow-y-auto"
                onClick={e => e.stopPropagation()}
                onSubmit={(event) => { void handleSubmit(event); }}
                role="dialog" aria-modal="true" aria-labelledby="add-memory-title" aria-describedby="add-memory-status" aria-busy={saving}>
                <h3 id="add-memory-title" className="text-base font-semibold text-slate-900 dark:text-white font-display">Add Memory</h3>
                <FieldWrapper label="Memory Content" htmlFor="memory-content" required forceTouch={showError} error={contentInvalid ? "Content is required" : undefined}>
                    <textarea id="memory-content" ref={contentRef} value={content}
                        aria-invalid={contentInvalid}
                        aria-describedby={describedBy}
                        onBlur={() => setShowError(true)}
                        onInput={e => {
                            setContent((e.target as HTMLTextAreaElement).value);
                            if (feedback.status === "error") {
                                setFeedback({ status: "idle", message: null });
                            }
                        }}
                        placeholder="What should be remembered…"
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl text-sm
                                   bg-black/[0.03] dark:bg-white/[0.03]
                                   border border-black/[0.06] dark:border-white/[0.06]
                                   text-slate-800 dark:text-slate-200
                                   placeholder:text-slate-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors duration-200
                                   focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800
                                   resize-none" />
                </FieldWrapper>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full">
                    <div className="w-full sm:flex-1">
                        <FieldWrapper label="Category" htmlFor="memory-category">
                            <select id="memory-category" value={category} onChange={e => setCategory((e.target as HTMLSelectElement).value as MemoryCategory)}
                                className="w-full px-3 py-2 rounded-lg text-xs font-medium cursor-pointer
                                           bg-black/[0.03] dark:bg-white/[0.03] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors duration-200
                                           border border-black/[0.06] dark:border-white/[0.06]
                                           text-slate-700 dark:text-slate-300
                                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800">
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </FieldWrapper>
                    </div>
                    <div className="w-full sm:w-auto flex items-center gap-2">
                        <FieldWrapper label="Strength" htmlFor="memory-strength">
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-mono text-slate-400">{Math.round(strength * 100)}%</span>
                                <input type="range" id="memory-strength" min="0.1" max="1" step="0.1" value={strength}
                                    onInput={e => setStrength(parseFloat((e.target as HTMLInputElement).value))}
                                    className="w-20 accent-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 cursor-pointer" />
                            </div>
                        </FieldWrapper>
                    </div>
                </div>
                <div
                    id="add-memory-status"
                    role={feedbackIsError ? "alert" : "status"}
                    aria-live={feedbackIsError ? "assertive" : "polite"}
                    aria-atomic="true"
                    className={`min-h-9 rounded-xl border px-3 py-2 text-xs font-semibold transition-[background-color,border-color,color] motion-reduce:duration-0 ${
                        saving
                            ? "border-signal-500/18 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                            : feedback.status === "success"
                                ? "border-signal-500/18 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                                : feedback.status === "error"
                                    ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
                                    : "border-black/[0.04] bg-black/[0.02] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
                    }`}
                    style={{ transitionDuration: interactionTokens.asyncFeedback.duration, transitionTimingFunction: interactionTokens.asyncFeedback.ease }}
                >
                    {saving ? (
                        <span className="inline-flex items-center gap-2"><Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> Saving memory...</span>
                    ) : feedback.status === "success" ? (
                        <span className="inline-flex items-center gap-2"><CheckCircle2 size={14} aria-hidden="true" /> {feedback.message}</span>
                    ) : feedback.message ? feedback.message : "Content is validated when you leave the field or submit."
                    }
                </div>
                <div className="flex items-center gap-2 pt-2">
                    <button type="button" onClick={closeModal} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold cursor-pointer
                                   bg-black/[0.04] dark:bg-white/[0.04] text-slate-500 hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-slate-900 dark:hover:text-white
                                   transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-void-800">
                        Cancel
                    </button>
                    <button type="submit"
                        aria-disabled={!content.trim() || saving}
                        disabled={saving}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold
                                   bg-signal-500 text-white dark:text-void-900 hover:bg-signal-400
                                   shadow-[0_2px_12px_rgba(0,224,160,0.3)]
                                   transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800
                                   ${(!content.trim() || saving) ? "opacity-50 cursor-not-allowed" : ""}`}>
                        {saving ? "Saving…" : "Add Memory"}
                    </button>
                </div>
            </form>
        </div>
    );
};
