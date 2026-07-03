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
    const strengthPercent = Math.round(strength * 100);
    const scopeLabel = scope || "unknown";

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
                group relative w-full cursor-pointer overflow-hidden rounded-2xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-void-900
                ${isSelected.value
                    ? "z-10 border-signal-500/55 bg-white/86 shadow-[inset_3px_0_0_rgba(0,224,160,0.86),0_10px_30px_rgba(0,224,160,0.12)] dark:bg-void-800/82 dark:shadow-[inset_3px_0_0_rgba(0,224,160,0.9),0_12px_28px_rgba(0,0,0,0.28)]"
                    : isBatchSelected.value
                        ? "border-signal-500/32 bg-signal-500/[0.055] shadow-[inset_3px_0_0_rgba(0,224,160,0.45)] dark:bg-signal-500/[0.075]"
                        : "border-black/[0.06] bg-white/68 shadow-[0_2px_14px_rgba(15,23,42,0.035)] hover:border-black/[0.1] hover:bg-white/88 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-void-800/52 dark:hover:border-white/[0.11] dark:hover:bg-void-800/78 dark:hover:shadow-[0_10px_28px_rgba(0,0,0,0.24)]"
                }
                ${lobotomizeModeSignal.value ? "border-status-red/36 bg-status-red/[0.045] hover:border-status-red/70 hover:bg-status-red/[0.075] dark:bg-status-red/[0.055]" : ""}
            `}
        >
            <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 8px ${cat.hex}` }} />
                            <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: cat.hex }}>
                                {cat.label}
                            </span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            <span className="max-w-full truncate rounded-full border border-black/[0.05] bg-black/[0.025] px-2 py-0.5 font-mono uppercase tracking-[0.12em] dark:border-white/[0.06] dark:bg-white/[0.035]">
                                {scopeLabel}
                            </span>
                            <span className="font-mono">{strengthPercent}% strength</span>
                        </div>
                    </div>
                    {isSelected.value && (
                        <span className="shrink-0 rounded-full border border-signal-500/24 bg-signal-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
                            Open
                        </span>
                    )}
                </div>

                <p className="min-w-0 break-words text-[13px] font-medium leading-relaxed text-slate-700 line-clamp-3 dark:text-slate-300">
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
                        className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-void-900
                            ${isBatchSelected.value
                                ? "border-signal-500 bg-signal-500 text-void-900 shadow-[0_4px_14px_rgba(0,224,160,0.18)]"
                                : "border-black/[0.06] bg-black/[0.025] text-slate-500 hover:border-signal-500/36 hover:bg-signal-500/[0.06] hover:text-signal-600 dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-slate-300 dark:hover:text-signal-400"
                            }`}
                    >
                        <Check size={12} strokeWidth={3} aria-hidden="true" className={isBatchSelected.value ? "opacity-100" : "opacity-45"} />
                        <span className="truncate">{isBatchSelected.value ? "Selected" : "Select"}</span>
                    </button>

                    <div className="ml-auto flex min-w-0 items-center gap-1.5">
                        <button
                            type="button"
                            aria-label={`Open ${cat.label} memory details`}
                            onClick={handleOpen}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/[0.06] bg-black/[0.025] text-slate-500 transition-colors duration-150 hover:border-signal-500/36 hover:bg-signal-500/[0.06] hover:text-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-slate-300 dark:hover:text-signal-400 dark:focus-visible:ring-offset-void-900"
                        >
                            <ArrowUpRight size={13} strokeWidth={2.25} aria-hidden="true" />
                        </button>
                        {lobotomizeModeSignal.value && (
                            <button
                                type="button"
                                aria-label={`Delete ${cat.label} memory: ${content.substring(0, 30)}...`}
                                onClick={handleDelete}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-status-red/28 bg-status-red/[0.08] text-status-red transition-colors duration-150 hover:border-status-red hover:bg-status-red hover:text-white active:bg-status-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-void-900"
                            >
                                <X size={13} strokeWidth={2.5} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <span className="sr-only">Press Enter to open details.</span>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength &&
           prevProps.scope === nextProps.scope
});
