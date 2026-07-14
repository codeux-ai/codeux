import { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { X } from "lucide-preact";
import gsap from "gsap";
import type { MemNode, Edge } from "../../lib/memory-graph.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { MEMORY_CATEGORY_MESSAGE_KEYS, MEMORY_SCOPE_MESSAGE_KEYS, useMemoryI18n } from "../../i18n/messages/memory.js";
import type { MemoryCategory, MemoryScope } from "../../memory-types.js";

const CAT: Record<string, { hex: string; r: number; g: number; b: number }> = {
    architecture: { hex: "#00E0A0", r: 0, g: 224, b: 160 }, codebase: { hex: "#FFB800", r: 255, g: 184, b: 0 },
    context: { hex: "#8B5CF6", r: 139, g: 92, b: 246 }, preferences: { hex: "#94A3B8", r: 148, g: 163, b: 184 },
    patterns: { hex: "#F59E0B", r: 245, g: 158, b: 11 }, decision: { hex: "#64748B", r: 100, g: 116, b: 139 },
    error: { hex: "#F43F5E", r: 244, g: 63, b: 94 }, learning: { hex: "#33FFB8", r: 51, g: 255, b: 184 },
};

export const Inspector: FunctionComponent<{
    node: MemNode | null;
    missingSelectedMemoryId?: string | null;
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
    entityLabel?: "memory" | "skill";
}> = ({ node, missingSelectedMemoryId = null, allNodes, edges, lobotomize, onClose, onDelete, entityLabel = "memory" }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const interactionTokens = useInteractionTokens();
    const gsapTokens = useGsapInteractionTokens();
    const { formatNumber, t } = useMemoryI18n();
    const entity = t(entityLabel === "skill" ? "skillNoun" : "memoryNoun");
    const isOpen = Boolean(node || missingSelectedMemoryId);
    const controlTransitionStyle = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const asyncTransitionStyle = {
        transitionDuration: interactionTokens.asyncFeedback.duration,
        transitionTimingFunction: interactionTokens.asyncFeedback.ease,
    };

    useLayoutEffect(() => {
        if (!contentRef.current || !isOpen) return;
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
            duration: gsapTokens.selectionMovement.duration,
            ease: gsapTokens.selectionMovement.ease,
            clearProps: "all"
        });
    }, [node?.id, missingSelectedMemoryId, isOpen, reducedMotion, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

    const handleDeleteClick = () => {
        if (!node) return;
        onDelete(node.id);
    };

    const cat = node ? (CAT[node.category] || CAT.context) : CAT.architecture;
    const categoryLabel = node ? t(MEMORY_CATEGORY_MESSAGE_KEYS[node.category as MemoryCategory] ?? "categoryContext") : t("categoryArchitecture");
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
            role="region"
            aria-label={node ? t("selectedDetails", { entity }) : missingSelectedMemoryId ? t("selectedUnavailable", { entity }) : t("inspectorLabel", { entity })}
            aria-live="polite"
            className="absolute inset-x-0 bottom-0 z-30 flex h-[min(56dvh,34rem)] w-full flex-col gap-4 overflow-hidden rounded-t-[1.5rem]
                       border-t border-black/[0.06] bg-white/90 p-5 pt-12 shadow-[0_-24px_70px_rgba(0,0,0,0.12)]
                       backdrop-blur-3xl transition-transform dark:border-white/[0.06] dark:bg-void-800/88
                       lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[300px] lg:rounded-none lg:border-l lg:border-t-0
                       lg:p-6 lg:pt-12 lg:shadow-[-20px_0_60px_rgba(0,0,0,0.08)] dark:lg:shadow-[-20px_0_60px_rgba(0,0,0,0.4)]"
            style={{
                transform: `translateX(${isOpen ? "0" : "100%"})`,
                transitionDuration: interactionTokens.selectionMovement.duration,
                transitionTimingFunction: interactionTokens.selectionMovement.ease,
                pointerEvents: isOpen ? "auto" : "none",
            }}
        >
            <button
                type="button"
                onClick={onClose}
                aria-label={t("closeInspector", { entity })}
                title={t("closeInspector", { entity })}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full
                           bg-black/[0.04] text-slate-500 transition-colors hover:bg-black/[0.08] hover:text-slate-700
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                style={controlTransitionStyle}
            >
                <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
            </button>
            {!node && (
                <p className="sr-only">{t("noSelectionInspector", { entity })}</p>
            )}
            {!node && missingSelectedMemoryId && (
                <div ref={contentRef} className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 dashboard-scrollbar">
                    <div className="rounded-xl border border-ember-500/20 bg-ember-500/[0.08] px-3 py-2 text-[11px] font-bold leading-4 text-ember-600 dark:text-ember-400">
                        {t("selectedNoLongerAvailable", { entity })}
                    </div>
                    <p className="text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                        {t("unavailableGuidance", { entity })}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-black/[0.06] bg-black/[0.04] px-4 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:focus-visible:ring-offset-void-900"
                        style={controlTransitionStyle}
                    >
                        {t("closeInspectorButton")}
                    </button>
                </div>
            )}
            {node && (
                <div ref={contentRef} className="flex min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pr-1 will-change-[opacity,transform] dashboard-scrollbar">
                    <div className="rounded-xl border border-signal-500/20 bg-signal-500/[0.08] px-3 py-2 text-[11px] font-bold text-signal-700 dark:text-signal-300">
                        {t("selectedOpenInspector", { entity })}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 10px ${cat.hex}` }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono" style={{ color: cat.hex }}>
                            {categoryLabel}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400 ml-auto px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.04]">
                            {t(MEMORY_SCOPE_MESSAGE_KEYS[node.scope as MemoryScope] ?? "scopeUnknown")}
                        </span>
                    </div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed break-words whitespace-pre-wrap">
                        {node.content}
                    </p>
                    <div className="flex flex-col gap-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{entityLabel === "skill" ? t("relevance") : t("strength")}</span>
                            <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                                    <div className="h-full rounded-full transition-[width]"
                                        style={{ ...asyncTransitionStyle, width: `${node.strength * 100}%`, background: cat.hex }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">{formatNumber(node.strength, { style: "percent", maximumFractionDigits: 0 })}</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("id")}</span>
                            <span className="text-[11px] font-mono text-slate-400">{node.id.slice(0, 8)}…</span>
                        </div>
                    </div>
                    {connected.length > 0 && (
                        <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                {t("synapses", { count: formatNumber(connected.length) })}
                            </span>
                            {connected.slice(0, 8).map(({ node: cn, similarity }) => (
                                <div key={cn.id} className="flex items-start gap-3 rounded-xl border border-black/[0.05] bg-black/[0.03] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
                                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: (CAT[cn.category] || CAT.context).hex }} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                                {t(MEMORY_CATEGORY_MESSAGE_KEYS[cn.category as MemoryCategory] ?? "categoryContext")}
                                            </span>
                                            <span className="rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] font-mono text-slate-400 dark:bg-white/[0.04]">
                                                {t(MEMORY_SCOPE_MESSAGE_KEYS[cn.scope as MemoryScope] ?? "scopeUnknown")}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[11px] font-medium leading-relaxed break-words text-slate-600 dark:text-slate-300 line-clamp-2">
                                            {cn.content}
                                        </p>
                                    </div>
                                    <span className="mt-0.5 shrink-0 text-[9px] font-mono text-slate-400"
                                        style={{ color: similarity > 0.7 ? (CAT[cn.category] || CAT.context).hex : undefined }}>
                                        {formatNumber(similarity, { style: "percent", maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {lobotomize && (
                        <div className="mt-auto flex flex-col gap-2">
                        <p className="rounded-xl border border-status-red/20 bg-status-red/[0.07] px-3 py-2 text-[11px] font-semibold leading-4 text-status-red">
                            {t("dangerInspector")}
                        </p>
                        <button
                            type="button"
                            onClick={handleDeleteClick}
                            aria-describedby="inspector-danger-delete-copy"
                            style={controlTransitionStyle}
                            className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl py-3
                                       bg-status-red text-white font-bold text-xs cursor-pointer
                                       shadow-[0_0_20px_rgba(227,0,15,0.3)] hover:bg-status-red/90 hover:shadow-[0_0_30px_rgba(227,0,15,0.5)]
                                       transition-[background-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900">
                            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                            {t("deleteImmediately")}
                        </button>
                        <span id="inspector-danger-delete-copy" className="sr-only">{t("dangerInspectorSr")}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
