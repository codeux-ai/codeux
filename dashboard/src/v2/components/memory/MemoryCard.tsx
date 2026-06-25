import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { activeMemoryIdSignal, hoveredMemoryIdSignal, lobotomizeModeSignal, memoriesSignal, memoryMutationsSignal } from "./memoryState.js";
import { useComputed } from "@preact/signals";
import { X } from "lucide-preact";
import { deleteMemory } from "../../lib/memory-api.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useInteractionTokens } from "../../lib/motion/index.js";

interface MemoryCardProps {
    id: string;
    content: string;
    category: string;
    strength: number;
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
    onClick,
}) => {
    const cat = CAT[category] || CAT.context;
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
            aria-label={`${cat.label} memory, strength ${Math.round(strength * 100)}%. ${content}`}
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
                    ? "bg-white dark:bg-void-800 border-signal-500 shadow-[0_4px_24px_rgba(0,224,160,0.15)] scale-[1.02]"
                    : "bg-white/60 dark:bg-void-800/50 border-black/[0.06] dark:border-white/[0.06] hover:bg-white dark:hover:bg-void-800 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] scale-100"
                }
                ${lobotomizeModeSignal.value && !isSelected.value ? "hover:border-status-red/30" : ""}
            `}
        >
            {lobotomizeModeSignal.value && (
                <button
                    type="button"
                    ref={triggerRef as any}
                    aria-label={`Delete ${cat.label} memory: ${content.substring(0, 30)}...`}
                    onClick={handleDelete}
                    className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                                ${isSelected.value ? "bg-status-red/10 text-status-red hover:bg-status-red hover:text-white" : "bg-black/5 dark:bg-white/5 text-slate-400 hover:bg-status-red hover:text-white"}`}
                >
                    <X size={14} strokeWidth={2.5} />
                </button>
            )}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 8px ${cat.hex}` }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: cat.hex }}>
                        {cat.label}
                    </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">{Math.round(strength * 100)}%</span>
            </div>
            <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed line-clamp-3">
                {content}
            </p>

            <ConfirmDialog
                isOpen={isConfirmOpen}
                options={confirmOptions}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                triggerRef={triggerRef}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength
});
