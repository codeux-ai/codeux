import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { activeMemoryIdSignal, hoveredMemoryIdSignal, lobotomizeModeSignal, memoryMutationsSignal, selectedMemoryIdsSignal, toggleSelectedMemoryId } from "./memoryState.js";
import { useComputed } from "@preact/signals";
import { ArrowUpRight, Check, X } from "lucide-preact";
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

const CAT: Record<string, { label: string; hex: string }> = {
    architecture: { label: "Architecture", hex: "#00E0A0" },
    codebase:     { label: "Codebase",     hex: "#FFB800" },
    context:      { label: "Context",      hex: "#8B5CF6" },
    preferences:  { label: "Preferences",  hex: "#94A3B8" },
    patterns:     { label: "Patterns",     hex: "#F59E0B" },
    decision:     { label: "Decision",     hex: "#64748B" },
    error:        { label: "Error",        hex: "#F43F5E" },
    learning:     { label: "Learning",     hex: "#33FFB8" },
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
    const isSelected = useComputed(() => activeMemoryIdSignal.value === id);
    const isBatchSelected = useComputed(() => selectedMemoryIdsSignal.value.includes(id));
    const interactionTokens = useInteractionTokens();
    const scopeLabel = scope || "unknown";
    const strengthPercent = Math.round(strength * 100);
    const selectedState = isSelected.value ? "Currently open in inspector." : isBatchSelected.value ? "Selected for batch action." : "Not selected.";

    const handleDelete = (e: Event) => {
        e.stopPropagation();
        memoryMutationsSignal.value.removeMemory(id);
    };

    const handleOpen = (e: Event) => {
        e.stopPropagation();
        onClick();
    };

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={isSelected.value}
            aria-label={`${cat.label} memory, scope ${scopeLabel}, strength ${strengthPercent}%. ${selectedState} ${content}`}
            onClick={onClick}
            onMouseEnter={() => { hoveredMemoryIdSignal.value = id; }}
            onMouseLeave={() => { hoveredMemoryIdSignal.value = null; }}
            onKeyDown={(e) => {
                if (e.currentTarget !== e.target) {
                    return;
                }
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                transitionProperty: "background-color, border-color, box-shadow, transform",
                transitionDuration: interactionTokens.enterExit.duration,
                transitionTimingFunction: interactionTokens.enterExit.ease,
            }}
            className={`
                group relative w-full cursor-pointer overflow-hidden rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                ${isSelected.value
                    ? "z-10 border-signal-500/80 bg-signal-500/[0.08] shadow-[0_8px_24px_rgba(0,224,160,0.12)] ring-1 ring-signal-500/40"
                    : isBatchSelected.value
                        ? "border-signal-500/35 bg-signal-500/[0.05] ring-1 ring-signal-500/20"
                        : "border-black/[0.06] bg-white/70 hover:border-black/[0.1] hover:bg-white hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-800/70 dark:hover:border-white/[0.12] dark:hover:bg-void-800 dark:hover:shadow-[0_10px_24px_rgba(0,0,0,0.26)]"
                }
                ${lobotomizeModeSignal.value ? "border-status-red/35 ring-1 ring-status-red/25 hover:border-status-red/70 hover:bg-status-red/[0.08] hover:ring-status-red/45" : ""}
            `}
        >
            <div
                className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full transition-opacity duration-150 ${isSelected.value || isBatchSelected.value ? "opacity-100" : "opacity-55 group-hover:opacity-100"}`}
                style={{ background: cat.hex, boxShadow: isSelected.value ? `0 0 12px ${cat.hex}` : undefined }}
                aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-2.5 pl-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.hex }} aria-hidden="true" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: cat.hex }}>
                                {cat.label}
                            </span>
                        </div>
                        <span className="truncate text-[10px] font-mono font-medium uppercase text-slate-400 dark:text-slate-500">
                            {scopeLabel} scope
                        </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                            {strengthPercent}%
                        </span>
                        {(isSelected.value || isBatchSelected.value) && (
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${isSelected.value ? "bg-signal-500 text-void-950" : "bg-signal-500/[0.12] text-signal-600 dark:text-signal-300"}`}>
                                {isSelected.value ? "Open" : "Selected"}
                            </span>
                        )}
                    </div>
                </div>

                <p className="line-clamp-3 break-words text-[13px] font-semibold leading-snug text-slate-700 dark:text-void-100">
                    {content}
                </p>

                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-2 dark:border-white/[0.06]">
                    <button
                        type="button"
                        aria-pressed={isBatchSelected.value}
                        aria-label={isBatchSelected.value ? `Deselect ${cat.label} memory` : `Select ${cat.label} memory`}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectedMemoryId(id);
                        }}
                        className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                            ${isBatchSelected.value
                                ? "border-signal-500 bg-signal-500 text-void-950 shadow-[0_4px_14px_rgba(0,224,160,0.18)]"
                                : "border-black/[0.06] bg-black/[0.03] text-slate-500 hover:border-signal-500/45 hover:bg-signal-500/[0.08] hover:text-signal-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-signal-400"
                            }`}
                    >
                        <Check size={13} strokeWidth={3} aria-hidden="true" className={isBatchSelected.value ? "opacity-100" : "opacity-45"} />
                        <span className="truncate">{isBatchSelected.value ? "Selected" : "Select"}</span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            aria-label={`Open ${cat.label} memory details`}
                            onClick={handleOpen}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-slate-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                        >
                            <span>Open</span>
                            <ArrowUpRight size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        {lobotomizeModeSignal.value && (
                            <button
                                type="button"
                                aria-label={`Delete ${cat.label} memory: ${content.substring(0, 30)}...`}
                                aria-describedby={`danger-delete-${id}`}
                                onClick={handleDelete}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-status-red/30 bg-status-red/[0.08] text-status-red transition-colors duration-150 hover:border-status-red hover:bg-status-red hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 active:bg-status-red/90 dark:focus-visible:ring-offset-void-900"
                            >
                                <X size={14} strokeWidth={2.5} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <span className="sr-only">Press Enter to open details.</span>
            {lobotomizeModeSignal.value && (
                <span id={`danger-delete-${id}`} className="sr-only">Danger delete is armed. This deletes immediately without confirmation.</span>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength &&
           prevProps.scope === nextProps.scope
});
