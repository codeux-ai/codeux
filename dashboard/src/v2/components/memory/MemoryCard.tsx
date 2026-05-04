import { memo } from "preact/compat";
import type { MemNode } from "../../lib/memory-graph.js";

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

interface MemoryCardProps {
    node: MemNode;
    isSelected: boolean;
    onSelect: (id: string) => void;
}

export const MemoryCard = memo(({ node, isSelected, onSelect }: MemoryCardProps) => {
    const color = CAT[node.category]?.hex || "#94a3b8";

    return (
        <div
            onClick={() => onSelect(node.id)}
            className={`
                cursor-pointer p-4 rounded-2xl border transition-all duration-200
                ${isSelected
                    ? "bg-signal-50 dark:bg-void-800 border-signal-500 shadow-sm"
                    : "bg-white dark:bg-void-900 border-slate-200 dark:border-void-700 hover:border-signal-500/50 hover:shadow-sm"}
            `}
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {node.category}
                </span>
                <span className="ml-auto text-[10px] text-slate-400">
                    {""}
                </span>
            </div>

            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 mb-2">
                {node.content}
            </h4>
        </div>
    );
});
