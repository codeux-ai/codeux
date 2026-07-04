import { FunctionComponent } from "preact";
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { Loader2 } from "lucide-preact";

import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import gsap from "gsap";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useComputed } from "@preact/signals";
import { MemoryCard } from "./MemoryCard.js";
import { clearSelectedMemoryIds, searchQuerySignal, selectVisibleMemoryIds, selectedMemoryIdsSignal, activeTierSignal, memoryMutationsSignal } from "./memoryState.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
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
            .filter(({ node }) => {
                if (!node.alive) {
                    return false;
                }

                return node.content.toLowerCase().includes(lower) || node.category.toLowerCase().includes(lower);
            });
    });

    const reducedMotion = useReducedMotion();
    const gsapTokens = useGsapInteractionTokens();
    const interactionTokens = useInteractionTokens();
    const listRef = useRef<HTMLDivElement>(null);
    const selectAllRef = useRef<HTMLButtonElement>(null);
    const [renderedNodes, setRenderedNodes] = useState(filteredNodes.value);
    const prevRenderedIds = useRef<Set<string>>(new Set());
    const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();

    useEffect(() => {
        if (reducedMotion) {
            setRenderedNodes(filteredNodes.value);
            return;
        }

        const currentIds = new Set(filteredNodes.value.map((n: { node: MemNode }) => n.node.id));
        const renderedIds = new Set(renderedNodes.map((n: { node: MemNode }) => n.node.id));
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
                    duration: gsapTokens.expansionCollapse.duration,
                    ease: gsapTokens.expansionCollapse.ease,
                    onComplete: () => {
                        setRenderedNodes(filteredNodes.value);
                    }
                });
                return;
            }
        }
        setRenderedNodes(filteredNodes.value);
    }, [filteredNodes.value, reducedMotion, renderedNodes, gsapTokens.expansionCollapse.duration, gsapTokens.expansionCollapse.ease]);

    useEffect(() => {
        const visibleIds = new Set(filteredNodes.value.map(({ node }) => node.id));
        const selectedIds = selectedMemoryIdsSignal.value;
        if (selectedIds.length === 0) {
            return;
        }

        const nextSelectedIds = selectedIds.filter((id) => visibleIds.has(id));
        if (nextSelectedIds.length !== selectedIds.length) {
            selectedMemoryIdsSignal.value = nextSelectedIds;
        }
    }, [filteredNodes.value]);

    useLayoutEffect(() => {
        if (!listRef.current) return;
        if (reducedMotion) {
            const currentRenderedIds = new Set(renderedNodes.map((n: { node: MemNode }) => n.node.id));
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

        const currentRenderedIds = new Set(renderedNodes.map((n: { node: MemNode }) => n.node.id));
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
                    duration: gsapTokens.listReveal.duration,
                    stagger: 0.05,
                    ease: gsapTokens.listReveal.ease,
                    clearProps: "all"
                });
            }
        }

        prevRenderedIds.current = currentRenderedIds as unknown as Set<string>;
    }, [renderedNodes, reducedMotion, gsapTokens.listReveal.duration, gsapTokens.listReveal.ease]);

    const resultCount = renderedNodes.length;
    const totalAliveCount = nodes.filter((node) => node.alive).length;
    const visibleIds = filteredNodes.value.map(({ node }) => node.id);
    const selectedIds = selectedMemoryIdsSignal.value;
    const selectedCount = selectedIds.length;
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    const activeTier = useComputed(() => activeTierSignal.value);
    const mutationFeedback = memoryMutationsSignal.value.feedback;
    const isDeleting = mutationFeedback?.status === "pending" && Boolean(mutationFeedback.message?.toLowerCase().includes("deleting"));
    const countLabel = `${resultCount} ${resultCount === 1 ? "memory" : "memories"} shown`;
    const selectionLabel = selectedCount > 0
        ? `${selectedCount} ${selectedCount === 1 ? "memory" : "memories"} selected`
        : "No memories selected";

    const handleVisibleSelect = () => {
        selectVisibleMemoryIds(visibleIds);
    };

    const handleBatchDelete = async () => {
        if (selectedCount === 0) return;

        if (selectedCount > 1) {
            const confirmed = await requestConfirm({
                title: "Delete Selected Memories",
                body: `Delete ${selectedCount} selected memories? This action cannot be undone.`,
                confirmLabel: "Delete Memories",
                cancelLabel: "Cancel",
                destructive: true,
            });

            if (!confirmed) return;
        }

        const idsToDelete = [...selectedIds];
        await memoryMutationsSignal.value.removeMemories(idsToDelete);
        requestAnimationFrame(() => {
            const target = selectAllRef.current || listRef.current?.querySelector<HTMLElement>('[role="option"]');
            target?.focus();
        });
    };

    if (renderedNodes.length === 0) {
        const isEmpty = totalAliveCount === 0;
        const message = isEmpty ? "No memories exist" : "No memories match your search or filters";
        const query = searchQuerySignal.value.trim();
        return (
            <div
                id="memory-panel"
                aria-labelledby={`tab-${activeTier.value}`}
                className="flex min-h-0 min-w-0 flex-col items-center justify-center p-8 text-center text-slate-400"
                role="listbox"
                aria-label="Memory List"
            >
                <div className="sr-only" aria-live="polite" aria-atomic="true">
                    <span>{message}</span>
                    <span>. Showing 0 of {totalAliveCount} memories.</span>
                </div>
                <p className="max-w-full break-words text-sm font-medium">{message}</p>
                {!isEmpty && (
                    <p className="mt-2 max-w-full break-words text-xs font-medium text-slate-400 dark:text-slate-500">
                        Showing 0 of {totalAliveCount} memories{query ? ` for "${query}"` : ""}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div
            id="memory-panel"
            aria-labelledby={`tab-${activeTier.value}`}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-2 dashboard-scrollbar"
            role="listbox"
            aria-label="Memory List"
            aria-describedby="memory-list-status memory-list-selection-status"
        >
            <div id="memory-list-status" className="sr-only" aria-live="polite" aria-atomic="true">
                {countLabel}
                {searchQuerySignal.value.trim() ? ` for ${searchQuerySignal.value.trim()}` : ""}
            </div>
            <div id="memory-list-selection-status" className="sr-only" aria-live="polite" aria-atomic="true">
                {selectionLabel}
            </div>
            <div className="sticky top-0 z-10 flex min-w-0 flex-col gap-2">
                <div className="inline-flex max-w-full items-center gap-1.5 self-start rounded-lg border border-black/[0.04] bg-black/[0.02] px-2 py-1 text-xs font-medium text-slate-500 dark:border-white/[0.04] dark:bg-white/[0.02] dark:text-slate-400">
                    <span className="truncate">
                        Showing {resultCount} of {totalAliveCount} memories
                        {searchQuerySignal.value.trim() ? ` for "${searchQuerySignal.value.trim()}"` : ""}
                    </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                        ref={selectAllRef}
                        type="button"
                        onClick={handleVisibleSelect}
                        disabled={visibleIds.length === 0 || allVisibleSelected}
                        title={allVisibleSelected ? "All currently visible memories are already selected." : undefined}
                        className="rounded-lg border border-black/[0.06] bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition-colors duration-150 hover:bg-black/[0.08] hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                        {allVisibleSelected ? "All visible selected" : "Select all visible"}
                    </button>
                    {selectedCount > 0 && (
                        <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-xs font-semibold text-signal-500">
                            <span>{selectedCount} selected</span>
                            <button
                                type="button"
                                onClick={clearSelectedMemoryIds}
                                disabled={isDeleting}
                                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-700 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleBatchDelete(); }}
                                disabled={isDeleting}
                                aria-describedby="memory-list-selection-status"
                                className="inline-flex items-center gap-1.5 rounded-md bg-status-red px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-status-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-void-900"
                            >
                                {isDeleting && <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />}
                                {isDeleting ? "Deleting..." : selectedCount > 1 ? `Delete ${selectedCount} selected` : "Delete selected"}
                            </button>
                        </div>
                    )}
                </div>
                <ActionFeedbackRegion
                    status={mutationFeedback?.status || "idle"}
                    message={mutationFeedback?.message}
                    onDismiss={memoryMutationsSignal.value.clearFeedback}
                    clearError={memoryMutationsSignal.value.clearError}
                    retryAction={mutationFeedback?.retryAction}
                    retryLabel={mutationFeedback?.retryLabel}
                />
            </div>
            <div
                className="flex min-w-0 flex-col gap-3 transition-[gap] motion-reduce:transition-none"
                style={{
                    transitionDuration: interactionTokens.listReorder.duration,
                    transitionTimingFunction: interactionTokens.listReorder.ease,
                }}
                ref={listRef}
                data-reduced-motion={reducedMotion ? "true" : "false"}
            >
                {renderedNodes.map(({ node, index }: { node: MemNode; index: number }) => (
                    <div key={node.id} data-memory-id={node.id} className="min-w-0 will-change-transform transform-gpu">
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
            <ConfirmDialog
                isOpen={isConfirmOpen}
                options={confirmOptions}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </div>
    );
};
