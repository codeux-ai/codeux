import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { activeMemoryIdSignal } from "./memoryState.js";
import { useComputed } from "@preact/signals";

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
    context:      { label: "Context",      hex: "#00AB84" },
    preferences:  { label: "Preferences",  hex: "#94a3b8" },
    patterns:     { label: "Patterns",     hex: "#F59E0B" },
    decision:     { label: "Decision",     hex: "#8B5CF6" },
    error:        { label: "Error",        hex: "#EF4444" },
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

    return (
        <div
            onClick={onClick}
            className={`
                cursor-pointer p-4 rounded-[1.25rem] border transition-all duration-200
                ${isSelected.value
                    ? "bg-white dark:bg-void-800 border-signal-500 shadow-[0_4px_24px_rgba(0,224,160,0.15)]"
                    : "bg-white/60 dark:bg-void-800/50 border-black/[0.06] dark:border-white/[0.06] hover:bg-white dark:hover:bg-void-800 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
                }
            `}
        >
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
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength
});
