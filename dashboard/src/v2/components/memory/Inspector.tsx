import { FunctionComponent } from "preact";
import { X } from "lucide-react";
import type { MemNode, Edge } from "../../lib/memory-graph.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";

const CAT: Record<string, { label: string; hex: string; r: number; g: number; b: number }> = {
    architecture: { label: "Architecture", hex: "#00E0A0", r: 0,   g: 224, b: 160 },
    codebase:     { label: "Codebase",     hex: "#FFB800", r: 255, g: 184, b: 0   },
    context:      { label: "Context",      hex: "#8B5CF6", r: 139, g: 92,  b: 246 },
    preferences:  { label: "Preferences",  hex: "#94A3B8", r: 148, g: 163, b: 184 },
    patterns:     { label: "Patterns",     hex: "#F59E0B", r: 245, g: 158, b: 11  },
    decision:     { label: "Decision",     hex: "#64748B", r: 100, g: 116, b: 139 },
    error:        { label: "Error",        hex: "#F43F5E", r: 244, g: 63,  b: 94  },
    learning:     { label: "Learning",     hex: "#33FFB8", r: 51,  g: 255, b: 184 },
};

export const Inspector: FunctionComponent<{
    node: MemNode | null;
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
}> = ({ node, allNodes, edges, lobotomize, onClose, onDelete }) => {
    const { isOpen, options, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();

    const handleDeleteClick = async () => {
        if (!node) return;
        const confirmed = await requestConfirm({
            title: "Excise Memory",
            body: "Are you sure you want to delete this memory? This action cannot be undone.",
            confirmLabel: "Excise",
            destructive: true
        });
        if (confirmed) {
            onDelete(node.id);
        }
    };

    const cat = node ? (CAT[node.category] || CAT.context) : CAT.architecture;
    const nodeIdx = node ? allNodes.findIndex(n => n.id === node.id) : -1;
    const connected = node ? edges
        .filter(e => e.a === nodeIdx || e.b === nodeIdx)
        .map(e => ({
            node: allNodes[e.a === nodeIdx ? e.b : e.a],
            similarity: e.similarity,
        }))
        .filter(c => c.node.alive)
        .sort((a, b) => b.similarity - a.similarity) : [];

    return (
        <div
            className="absolute right-0 top-0 bottom-0 w-[300px] z-30
                       bg-white/80 dark:bg-void-800/80 backdrop-blur-3xl
                       border-l border-black/[0.06] dark:border-white/[0.06]
                       shadow-[-20px_0_60px_rgba(0,0,0,0.08)] dark:shadow-[-20px_0_60px_rgba(0,0,0,0.4)]
                       p-6 flex flex-col gap-4 overflow-y-auto dashboard-scrollbar
                       transition-transform duration-500"
            style={{
                transform: `translateX(${node ? "0" : "100%"})`,
                transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
                pointerEvents: node ? "auto" : "none",
            }}
        >
            <button onClick={onClose}
                className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center
                           bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                           transition-colors duration-200">
                <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
            </button>
            {node && (
                <>
                    <div className="flex items-center gap-2 pt-1">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 10px ${cat.hex}` }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono" style={{ color: cat.hex }}>
                            {cat.label}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400 ml-auto px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.04]">
                            {node.scope}
                        </span>
                    </div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed break-words whitespace-pre-wrap">
                        {node.content}
                    </p>
                    <div className="flex flex-col gap-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Strength</span>
                            <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-700"
                                        style={{ width: `${node.strength * 100}%`, background: cat.hex }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">{Math.round(node.strength * 100)}%</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">ID</span>
                            <span className="text-[11px] font-mono text-slate-400">{node.id.slice(0, 8)}…</span>
                        </div>
                    </div>
                    {connected.length > 0 && (
                        <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                Synapses ({connected.length})
                            </span>
                            {connected.slice(0, 8).map(({ node: cn, similarity }) => (
                                <div key={cn.id} className="flex items-start gap-2 py-1">
                                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                        style={{ background: (CAT[cn.category] || CAT.context).hex }} />
                                    <span className="sr-only">{(CAT[cn.category] || CAT.context).label}</span>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 font-medium">
                                            {cn.content}
                                        </span>
                                    </div>
                                    <span className="text-[9px] font-mono text-slate-400 shrink-0 mt-0.5"
                                        style={{ color: similarity > 0.7 ? (CAT[cn.category] || CAT.context).hex : undefined }}>
                                        {Math.round(similarity * 100)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {lobotomize && (
                        <>
                            <button onClick={handleDeleteClick}
                                ref={triggerRef as any}
                                className="mt-auto flex items-center justify-center gap-2 w-full py-3 rounded-xl
                                           bg-status-red text-white font-bold text-xs cursor-pointer
                                           shadow-[0_0_20px_rgba(227,0,15,0.3)] hover:bg-status-red/90 hover:shadow-[0_0_30px_rgba(227,0,15,0.5)]
                                           transition-[background-color,box-shadow,color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900">
                                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                                Excise Memory
                            </button>
                            <ConfirmDialog
                                isOpen={isOpen}
                                options={options}
                                onConfirm={handleConfirm}
                                onCancel={handleCancel}
                                triggerRef={triggerRef}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
};
