import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { activeMemoryIdSignal, hoveredMemoryIdSignal, lobotomizeModeSignal, memoryMutationsSignal } from "./memoryState.js";
import { useComputed } from "@preact/signals";
import { X } from "lucide-preact";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import type { MemoryScope } from "../../memory-types.js";

interface MemoryCardProps {
    id: string;
    content: string;
    category: string;
    strength: number;
    scope?: MemoryScope | string;
    onClick: () => void;
}

const CAT: Record<string, { label: string; hex: string; r: number; g: number; b: number }> = {
    architecture: { label: "Architecture", hex: "#00C8A0", r: 0, g: 200, b: 160 },
    codebase:     { label: "Codebase",     hex: "#F59E0B", r: 245, g: 158, b: 11 },
    context:      { label: "Context",      hex: "#8B5CF6", r: 139, g: 92, b: 246 },
    preferences:  { label: "Preferences",  hex: "#94A3B8", r: 148, g: 163, b: 184 },
    patterns:     { label: "Patterns",     hex: "#38BDF8", r: 56, g: 189, b: 248 },
    decision:     { label: "Decision",     hex: "#14B8A6", r: 20, g: 184, b: 166 },
    error:        { label: "Error",        hex: "#F43F5E", r: 244, g: 63, b: 94 },
    learning:     { label: "Learning",     hex: "#A3E635", r: 163, g: 230, b: 53 },
};

export const MemoryCard: FunctionComponent<MemoryCardProps> = memo(({
    id,
    content,
    category,
    strength,
    scope,
    onClick,
}) => {
    const cat = CAT[category] || CAT.context;
    const strengthPercent = Math.round(strength * 100);
    const scopeLabel = scope ? String(scope).replace("_", " ") : "unknown";
    const isSelected = useComputed(() => activeMemoryIdSignal.value === id);
    const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();
    const interactionTokens = useInteractionTokens();

    const handleDelete = async (e: Event) => {
        e.stopPropagation();
        const confirmed = await requestConfirm({
            title: "Delete Memory",
            body: `Are you sure you want to delete this memory from ${cat.label}?`,
            confirmLabel: "Delete Memory",
            cancelLabel: "Cancel",
            destructive: true
        });

        if (confirmed) {
            memoryMutationsSignal.value.removeMemory(id);
        }
    };

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={isSelected.value}
            aria-label={`${cat.label} memory, scope ${scopeLabel}, strength ${strengthPercent}%. ${content}`}
            onClick={onClick}
            onMouseEnter={() => { hoveredMemoryIdSignal.value = id; }}
            onMouseLeave={() => { hoveredMemoryIdSignal.value = null; }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                transitionProperty: "background-color, border-color, box-shadow, transform",
                transitionDuration: `${interactionTokens.enterExit.duration}s`,
                transitionTimingFunction: interactionTokens.enterExit.ease,
            }}
            className={`
                group relative cursor-pointer p-4 rounded-lg border text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                ${isSelected.value
                    ? "bg-signal-500/5 dark:bg-signal-500/10 border-signal-500/70 ring-1 ring-signal-500/50 shadow-[0_6px_24px_rgba(0,224,160,0.14)] scale-[1.01] z-10"
                    : "bg-white/70 dark:bg-void-800/55 border-black/[0.08] dark:border-white/[0.08] hover:bg-white dark:hover:bg-void-800 hover:border-black/[0.12] dark:hover:border-white/[0.12] hover:shadow-[0_6px_18px_rgba(15,23,42,0.07)] dark:hover:shadow-[0_6px_18px_rgba(0,0,0,0.24)] scale-100"
                }
                ${lobotomizeModeSignal.value ? "ring-1 ring-status-red/50 hover:bg-status-red/10 hover:border-status-red hover:ring-status-red hover:shadow-[0_4px_24px_rgba(227,0,15,0.15)]" : ""}
            `}
        >
            {lobotomizeModeSignal.value && (
                <button
                    type="button"
                    ref={triggerRef as any}
                    aria-label={`Delete ${cat.label} memory: ${content.substring(0, 30)}...`}
                    onClick={handleDelete}
                    className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                                bg-white/80 dark:bg-void-800/80 backdrop-blur border border-status-red/20 text-status-red shadow-sm hover:bg-status-red hover:text-white hover:border-status-red active:bg-status-red/90 active:scale-95
                                ${isSelected.value ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                >
                    <X size={14} strokeWidth={2.5} />
                </button>
            )}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={{
                            color: cat.hex,
                            borderColor: `rgba(${cat.r}, ${cat.g}, ${cat.b}, 0.28)`,
                            backgroundColor: `rgba(${cat.r}, ${cat.g}, ${cat.b}, 0.09)`,
                        }}
                    >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.hex }} />
                        {cat.label}
                    </span>
                    <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                        {scopeLabel}
                    </span>
                </div>
                <span className="shrink-0 rounded-md bg-black/[0.04] px-2 py-1 text-[10px] font-mono text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                    {strengthPercent}%
                </span>
            </div>
            <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed line-clamp-3">
                {content}
            </p>
            <span className="sr-only">Press Enter to open details.</span>

            <ConfirmDialog
                isOpen={isConfirmOpen}
                options={confirmOptions}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength &&
           prevProps.scope === nextProps.scope
});
