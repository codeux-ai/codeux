import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { activeMemoryIdSignal, hoveredMemoryIdSignal, lobotomizeModeSignal, memoryMutationsSignal, selectedMemoryIdsSignal, toggleSelectedMemoryId } from "./memoryState.js";
import { useComputed } from "@preact/signals";
import { Check, X } from "lucide-preact";
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

    const handleDelete = (e: Event) => {
        e.stopPropagation();
        memoryMutationsSignal.value.removeMemory(id);
    };

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={isSelected.value}
            aria-label={`${cat.label} memory, scope ${scope || 'unknown'}, strength ${Math.round(strength * 100)}%. ${content}`}
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
                group relative cursor-pointer p-4 rounded-[1.25rem] border text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                ${isSelected.value
                    ? "bg-signal-500/5 dark:bg-signal-500/10 border-signal-500 ring-1 ring-signal-500 shadow-[0_4px_24px_rgba(0,224,160,0.15)] z-10"
                    : isBatchSelected.value
                        ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08] border-signal-500/40 ring-1 ring-signal-500/30 shadow-[0_4px_20px_rgba(0,224,160,0.08)]"
                        : "bg-white/60 dark:bg-void-800/50 border-black/[0.06] dark:border-white/[0.06] hover:bg-white dark:hover:bg-void-800 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] scale-100"
                }
                ${lobotomizeModeSignal.value ? "ring-1 ring-status-red/50 hover:bg-status-red/10 hover:border-status-red hover:ring-status-red hover:shadow-[0_4px_24px_rgba(227,0,15,0.15)]" : ""}
            `}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        aria-pressed={isBatchSelected.value}
                        aria-label={isBatchSelected.value ? `Deselect ${cat.label} memory` : `Select ${cat.label} memory`}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectedMemoryId(id);
                        }}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                            ${isBatchSelected.value
                                ? "border-signal-500 bg-signal-500 text-white shadow-[0_4px_14px_rgba(0,224,160,0.25)]"
                                : "border-black/[0.08] bg-white/80 text-slate-500 hover:border-signal-500/40 hover:text-signal-500 dark:border-white/[0.08] dark:bg-void-800/80 dark:text-slate-300"
                            }`}
                    >
                        <Check size={13} strokeWidth={3} aria-hidden="true" className={isBatchSelected.value ? "opacity-100" : "opacity-0"} />
                    </button>
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.hex, boxShadow: `0 0 8px ${cat.hex}` }} />
                        <span className="truncate text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: cat.hex }}>
                            {cat.label}
                        </span>
                    </div>
                </div>
                <span className="text-[10px] font-mono text-slate-400">{Math.round(strength * 100)}%</span>
            </div>
            {lobotomizeModeSignal.value && (
                <button
                    type="button"
                    aria-label={`Delete ${cat.label} memory: ${content.substring(0, 30)}...`}
                    onClick={handleDelete}
                    className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                                bg-white/80 dark:bg-void-800/80 backdrop-blur border border-status-red/20 text-status-red shadow-sm hover:bg-status-red hover:text-white hover:border-status-red active:bg-status-red/90 active:scale-95
                                ${isSelected.value ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                >
                    <X size={14} strokeWidth={2.5} />
                </button>
            )}
            <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed line-clamp-3">
                {content}
            </p>
            <span className="sr-only">Press Enter to open details.</span>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength
});
