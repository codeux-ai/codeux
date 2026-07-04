import { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { X } from "lucide-preact";
import gsap from "gsap";
import type { MemNode, Edge } from "../../lib/memory-graph.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

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

const MetadataItem: FunctionComponent<{ label: string; value: string; title?: string }> = ({ label, value, title }) => (
    <div className="min-w-0 rounded-lg border border-black/[0.06] bg-black/[0.025] px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.035]">
        <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</dt>
        <dd title={title ?? value} className="mt-1 truncate font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            {value}
        </dd>
    </div>
);

export const Inspector: FunctionComponent<{
    node: MemNode | null;
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
}> = ({ node, allNodes, edges, lobotomize, onClose, onDelete }) => {
    const { isOpen, options, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();
    const contentRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        if (!contentRef.current || !node) return;
        if (reducedMotion) {
            gsap.set(contentRef.current, { opacity: 1, clearProps: "all" });
            return;
        }

        gsap.fromTo(contentRef.current, {
            opacity: 0,
            y: 5
        }, {
            opacity: 1,
            y: 0,
            duration: 0.2,
            ease: "power2.out",
            clearProps: "all"
        });
    }, [node?.id, reducedMotion]);

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
    const strengthPercent = node ? Math.round(node.strength * 100) : 0;
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
            className="absolute right-0 top-0 bottom-0 w-full lg:w-[360px] z-30
                       bg-white/90 dark:bg-void-800/90 backdrop-blur-3xl
                       border-l border-black/[0.08] dark:border-white/[0.08]
                       shadow-[-20px_0_60px_rgba(0,0,0,0.08)] dark:shadow-[-20px_0_60px_rgba(0,0,0,0.4)]
                       p-5 flex flex-col gap-4 overflow-y-auto dashboard-scrollbar
                       transition-transform duration-500"
            style={{
                transform: `translateX(${node ? "0" : "100%"})`,
                transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
                pointerEvents: node ? "auto" : "none",
            }}
        >
            <button onClick={onClose}
                aria-label="Close memory inspector"
                className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center
                           bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                           transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900">
                <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
            </button>
            {node && (
                <div ref={contentRef} className="flex flex-col gap-4 h-full will-change-[opacity,transform]">
                    <div className="pr-9">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Memory inspector</p>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                            <span
                                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                                style={{
                                    color: cat.hex,
                                    borderColor: `rgba(${cat.r}, ${cat.g}, ${cat.b}, 0.28)`,
                                    backgroundColor: `rgba(${cat.r}, ${cat.g}, ${cat.b}, 0.09)`,
                                }}
                            >
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.hex }} />
                                {cat.label}
                            </span>
                            <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                                {node.scope}
                            </span>
                        </div>
                    </div>

                    <section aria-labelledby="memory-inspector-content" className="rounded-lg border border-black/[0.06] bg-white/70 p-4 dark:border-white/[0.07] dark:bg-void-800/55">
                        <h3 id="memory-inspector-content" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Content</h3>
                        <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-[13px] font-medium leading-relaxed text-slate-700 dashboard-scrollbar dark:text-slate-300">
                            {node.content}
                        </p>
                    </section>

                    <section aria-labelledby="memory-inspector-metadata" className="flex flex-col gap-3">
                        <h3 id="memory-inspector-metadata" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Metadata</h3>
                        <dl className="grid grid-cols-2 gap-2">
                            <MetadataItem label="Category" value={cat.label} />
                            <MetadataItem label="Scope" value={node.scope} />
                            <MetadataItem label="Strength" value={`${strengthPercent}%`} />
                            <MetadataItem label="Memory ID" value={`${node.id.slice(0, 8)}...`} title={node.id} />
                        </dl>
                        <div className="rounded-lg border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.07] dark:bg-white/[0.035]">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Strength signal</span>
                                <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">{strengthPercent}%</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
                                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${strengthPercent}%`, background: cat.hex }} />
                            </div>
                        </div>
                    </section>

                    <section aria-labelledby="memory-inspector-related" className="flex flex-col gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
                        <div className="flex items-center justify-between gap-3">
                            <h3 id="memory-inspector-related" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                Related memories
                            </h3>
                            <span className="rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[10px] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                                {connected.length}
                            </span>
                        </div>
                        {connected.length > 0 ? (
                            connected.slice(0, 8).map(({ node: cn, similarity }) => (
                                <div key={cn.id} className="flex items-start gap-2 rounded-lg border border-black/[0.05] bg-black/[0.02] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                                        style={{ background: (CAT[cn.category] || CAT.context).hex }} />
                                    <span className="sr-only">{(CAT[cn.category] || CAT.context).label}</span>
                                    <div className="flex-1 min-w-0 break-words">
                                        <span className="line-clamp-2 text-[11px] font-medium leading-relaxed text-slate-600 dark:text-slate-400">
                                            {cn.content}
                                        </span>
                                    </div>
                                    <span className="text-[9px] font-mono text-slate-400 shrink-0 mt-0.5"
                                        style={{ color: similarity > 0.7 ? (CAT[cn.category] || CAT.context).hex : undefined }}>
                                        {Math.round(similarity * 100)}%
                                    </span>
                                </div>
                            ))
                        ) : (
                            <p className="rounded-lg border border-dashed border-black/[0.08] bg-black/[0.02] px-3 py-4 text-center text-[12px] font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02]">
                                No related memories in the current graph view.
                            </p>
                        )}
                    </section>
                    {lobotomize && (
                        <section aria-label="Destructive memory actions" className="mt-auto rounded-lg border border-status-red/25 bg-status-red/[0.06] p-3">
                            <p className="mb-3 text-[11px] font-medium leading-relaxed text-status-red">
                                Delete mode is active. This removes the selected memory after confirmation.
                            </p>
                            <button onClick={handleDeleteClick}
                                ref={triggerRef as any}
                                className="flex w-full items-center justify-center gap-2 rounded-lg py-3
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
                            />
                        </section>
                    )}
                </div>
            )}
        </div>
    );
};
