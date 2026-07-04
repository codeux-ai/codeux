import { FunctionComponent } from "preact";
import { useMemo, useState, useEffect } from "preact/hooks";
import { useLayoutEffect, useRef } from "preact/hooks";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";

import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import gsap from "gsap";
import { GSAP_INTERACTION_TOKENS } from "../../lib/motion/constants.js";
import { useComputed } from "@preact/signals";
import { MemoryCard } from "./MemoryCard.js";
import { searchQuerySignal, activeMemoryIdSignal, memoryMutationsSignal, activeTierSignal } from "./memoryState.js";
import type { MemNode } from "../../lib/memory-graph.js";

export const MemoryList: FunctionComponent<{
    nodes: MemNode[];
    onSelectNode: (idx: number) => void;
}> = ({ nodes, onSelectNode }) => {




    const filteredNodes = useComputed(() => {
        const query = searchQuerySignal.value;
        if (!query.trim()) {
            return nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.alive);
        }

        const lower = query.toLowerCase();
        return nodes
            .map((node, index) => ({ node, index }))
            .filter(({ node }) => node.alive && (node.content.toLowerCase().includes(lower) || node.category.toLowerCase().includes(lower)));
    });

    const reducedMotion = useReducedMotion();
    const listRef = useRef<HTMLDivElement>(null);
    const [renderedNodes, setRenderedNodes] = useState(filteredNodes.value);
    const prevRenderedIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (reducedMotion) {
            const currentIds = new Set(filteredNodes.value.map((n: any) => n.node.id));
            const renderedIds = new Set(renderedNodes.map((n: any) => n.node.id));
            const removedIds = Array.from(renderedIds).filter(id => !currentIds.has(id));
            if (removedIds.length > 0 && listRef.current) {
                const elementsToRemove = removedIds.map(id => listRef.current?.querySelector(`[data-memory-id="${id}"]`)).filter(Boolean);
                if (elementsToRemove.length > 0) {
                    gsap.set(elementsToRemove, {
                        opacity: 0,
                        scale: 0.95,
                        height: 0,
                        marginBottom: 0,
                        padding: 0
                    });
                }
            }
            setRenderedNodes(filteredNodes.value);
            return;
        }

        const currentIds = new Set(filteredNodes.value.map((n: any) => n.node.id));
        const renderedIds = new Set(renderedNodes.map((n: any) => n.node.id));
        const removedIds = Array.from(renderedIds).filter(id => !currentIds.has(id));

        if (removedIds.length > 0 && listRef.current) {
            const elementsToRemove = removedIds.map(id => listRef.current?.querySelector(`[data-memory-id="${id}"]`)).filter(Boolean);
            if (elementsToRemove.length > 0) {
                gsap.to(elementsToRemove, {
                    opacity: 0,
                    scale: 0.95,
                    height: 0,
                    marginBottom: 0,
                    padding: 0,
                    duration: GSAP_INTERACTION_TOKENS.expansionCollapse.duration,
                    ease: GSAP_INTERACTION_TOKENS.expansionCollapse.ease,
                    onComplete: () => {
                        setRenderedNodes(filteredNodes.value);
                    }
                });
                return;
            }
        }
        setRenderedNodes(filteredNodes.value);
    }, [filteredNodes.value, reducedMotion, renderedNodes]);

    useLayoutEffect(() => {
        if (!listRef.current) return;
        if (reducedMotion) {
            const currentRenderedIds = new Set(renderedNodes.map((n: any) => n.node.id));
            const addedIds = Array.from(currentRenderedIds).filter(id => !prevRenderedIds.current.has(id));
            if (addedIds.length > 0) {
                const addedElements = addedIds.map(id => listRef.current?.querySelector(`[data-memory-id="${id}"]`)).filter(Boolean);
                if (addedElements.length > 0) {
                    gsap.set(addedElements, { opacity: 1, y: 0, clearProps: "all" });
                }
            }
            prevRenderedIds.current = currentRenderedIds as unknown as Set<string>;
            return;
        }

        const currentRenderedIds = new Set(renderedNodes.map((n: any) => n.node.id));
        const addedIds = Array.from(currentRenderedIds).filter(id => !prevRenderedIds.current.has(id));

        if (addedIds.length > 0) {
            const addedElements = addedIds.map(id => listRef.current?.querySelector(`[data-memory-id="${id}"]`)).filter(Boolean);
            if (addedElements.length > 0) {
                gsap.fromTo(addedElements, {
                    opacity: 0,
                    y: 10,
                }, {
                    opacity: 1,
                    y: 0,
                    duration: GSAP_INTERACTION_TOKENS.enterExit.duration,
                    stagger: 0.05,
                    ease: GSAP_INTERACTION_TOKENS.enterExit.ease,
                    clearProps: "all"
                });
            }
        }

        prevRenderedIds.current = currentRenderedIds as unknown as Set<string>;
    }, [renderedNodes, reducedMotion]);

    if (renderedNodes.length === 0) {
        const isEmpty = nodes.length === 0;
        const message = isEmpty ? "No memories in this view" : "No memories match your search or filters";
        const description = isEmpty
            ? "Captured or manually added memories will appear here with matching graph nodes."
            : "Try a broader search term or switch memory scope filters.";
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
                <div className="sr-only" aria-live="polite" aria-atomic="true">{message}</div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-300">{message}</p>
                <p className="max-w-[16rem] text-xs leading-relaxed text-slate-400">{description}</p>
            </div>
        );
    }

    const activeTier = useComputed(() => activeTierSignal.value);

    return (
        <div id="memory-panel" aria-labelledby={`tab-${activeTier.value}`} className="flex flex-col gap-3 h-full overflow-y-auto dashboard-scrollbar p-2" role="listbox" aria-label="Memory List">
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {renderedNodes.length} memories found
            </div>
            <div className="sticky top-0 z-10 w-full flex flex-col gap-2">
                {searchQuerySignal.value && (
                    <div className="inline-block self-start rounded-lg border border-black/[0.06] bg-white/70 px-2 py-1 text-xs font-medium text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-400">
                        Showing {renderedNodes.length} result{renderedNodes.length !== 1 ? 's' : ''}
                    </div>
                )}
                <ActionFeedbackRegion
                    status={memoryMutationsSignal.value.feedback?.status || "idle"}
                    message={memoryMutationsSignal.value.feedback?.message}
                    onDismiss={memoryMutationsSignal.value.clearFeedback}
                    clearError={memoryMutationsSignal.value.clearError}
                    retryAction={memoryMutationsSignal.value.feedback?.retryAction}
                    retryLabel={memoryMutationsSignal.value.feedback?.retryLabel}
                />
            </div>
            <div className="flex flex-col gap-3" ref={listRef}>
                {renderedNodes.map(({ node, index }: any) => (
                    <div key={node.id} data-memory-id={node.id} className="will-change-transform transform-gpu">
                        <MemoryCard
                            key={node.id}
                            id={node.id}
                            content={node.content}
                            category={node.category}
                            strength={node.strength}
                            scope={node.scope}
                            onClick={() => onSelectNode(index)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
