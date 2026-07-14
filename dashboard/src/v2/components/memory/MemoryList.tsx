import { FunctionComponent } from "preact";
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { Loader2, Plus, RefreshCw, SearchX } from "lucide-preact";

import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import gsap from "gsap";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useComputed } from "@preact/signals";
import { MemoryCard } from "./MemoryCard.js";
import { clearSelectedMemoryIds, searchQuerySignal, selectVisibleMemoryIds, selectedMemoryIdsSignal, activeTierSignal, memoryMutationsSignal, selectedAgentPresetIdSignal, selectedSprintIdSignal } from "./memoryState.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import type { MemNode } from "../../lib/memory-graph.js";
import { MEMORY_CATEGORY_MESSAGE_KEYS, useMemoryI18n } from "../../i18n/messages/memory.js";
import type { MemoryCategory } from "../../memory-types.js";

export const MemoryList: FunctionComponent<{
    nodes: MemNode[];
    onSelectNode: (idx: number) => void;
    refreshing?: boolean;
    loadError?: string | null;
    onRetry?: () => void;
    onAddMemory?: () => void;
    readOnly?: boolean;
    entityLabel?: "memory" | "skill";
}> = ({ nodes, onSelectNode, refreshing = false, loadError = null, onRetry, onAddMemory, readOnly = false, entityLabel = "memory" }) => {
    const { formatNumber, t, tp } = useMemoryI18n();
    const committedQuery = searchQuerySignal.value;
    const filteredNodes = useMemo(() => {
        const query = committedQuery;
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

                const localizedCategory = t(MEMORY_CATEGORY_MESSAGE_KEYS[node.category as MemoryCategory] ?? "categoryContext").toLowerCase();
                return node.content.toLowerCase().includes(lower) || node.category.toLowerCase().includes(lower) || localizedCategory.includes(lower);
            });
    }, [committedQuery, nodes, t]);
    const currentContextKey = JSON.stringify({
        tier: activeTierSignal.value,
        sprintId: selectedSprintIdSignal.value ?? null,
        agentPresetId: selectedAgentPresetIdSignal.value ?? null,
        query: committedQuery.trim(),
    });

    const reducedMotion = useReducedMotion();
    const gsapTokens = useGsapInteractionTokens();
    const interactionTokens = useInteractionTokens();
    const listRef = useRef<HTMLDivElement>(null);
    const selectAllRef = useRef<HTMLButtonElement>(null);
    const lastUsefulNodes = useRef(filteredNodes);
    const lastUsefulContextKey = useRef(currentContextKey);
    const [renderedNodes, setRenderedNodes] = useState(filteredNodes);
    const [batchDeletePending, setBatchDeletePending] = useState(false);
    const [retryPending, setRetryPending] = useState(false);
    const prevRenderedIds = useRef<Set<string>>(new Set());
    const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
    const controlTransitionStyle = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const asyncTransitionStyle = {
        transitionDuration: interactionTokens.asyncFeedback.duration,
        transitionTimingFunction: interactionTokens.asyncFeedback.ease,
    };

    useEffect(() => {
        if (filteredNodes.length > 0) {
            lastUsefulNodes.current = filteredNodes;
            lastUsefulContextKey.current = currentContextKey;
        }
    }, [currentContextKey, filteredNodes]);

    useEffect(() => {
        const canShowLastUseful = (refreshing || loadError)
            && filteredNodes.length === 0
            && lastUsefulNodes.current.length > 0
            && lastUsefulContextKey.current === currentContextKey;
        const nextNodes = canShowLastUseful
            ? lastUsefulNodes.current
            : filteredNodes;

        if (reducedMotion) {
            setRenderedNodes(nextNodes);
            return;
        }

        if (filteredNodes.length === 0 && lastUsefulContextKey.current !== currentContextKey) {
            setRenderedNodes(nextNodes);
            return;
        }

        if (nextNodes.length === 0 && filteredNodes.length === 0 && searchQuerySignal.value.trim()) {
            setRenderedNodes(nextNodes);
            return;
        }

        const currentIds = new Set(nextNodes.map((n: { node: MemNode }) => n.node.id));
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
                        setRenderedNodes(nextNodes);
                    }
                });
                return;
            }
        }
        setRenderedNodes(nextNodes);
    }, [currentContextKey, filteredNodes, refreshing, loadError, reducedMotion, renderedNodes, gsapTokens.expansionCollapse.duration, gsapTokens.expansionCollapse.ease]);

    useEffect(() => {
        const visibleIds = new Set(
            (refreshing || loadError) && filteredNodes.length === 0 && lastUsefulContextKey.current === currentContextKey
                ? lastUsefulNodes.current.map(({ node }) => node.id)
                : filteredNodes.map(({ node }) => node.id)
        );
        const selectedIds = selectedMemoryIdsSignal.value;
        if (selectedIds.length === 0) {
            return;
        }

        const nextSelectedIds = selectedIds.filter((id) => visibleIds.has(id));
        if (nextSelectedIds.length !== selectedIds.length) {
            selectedMemoryIdsSignal.value = nextSelectedIds;
        }
    }, [currentContextKey, filteredNodes, refreshing, loadError]);

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
    const selectedIds = selectedMemoryIdsSignal.value;
    const selectedCount = selectedIds.length;
    const activeTier = useComputed(() => activeTierSignal.value);
    const selectedSprintId = selectedSprintIdSignal.value;
    const selectedAgentPresetId = selectedAgentPresetIdSignal.value;
    const mutationFeedback = memoryMutationsSignal.value.feedback;
    const isDeleting = batchDeletePending || mutationFeedback?.status === "pending";
    const entitySingular = t(entityLabel === "skill" ? "skillNoun" : "memoryNoun");
    const entityTitle = t(entityLabel === "skill" ? "skillTitle" : "memoryTitle");
    const entityPlural = t(entityLabel === "skill" ? "skillsNoun" : "memoriesNoun");
    const countLabel = tp(entityLabel === "skill" ? "shownSkill" : "shownMemory", resultCount, { formattedCount: formatNumber(resultCount) });
    const isShowingStaleResults = (refreshing || Boolean(loadError))
        && filteredNodes.length === 0
        && renderedNodes.length > 0
        && lastUsefulContextKey.current === currentContextKey;
    const query = searchQuerySignal.value.trim();
    const totalAliveCount = Math.max(
        nodes.filter((node) => node.alive).length,
        isShowingStaleResults ? renderedNodes.length : 0,
    );
    const visibleIds = (isShowingStaleResults ? renderedNodes : filteredNodes).map(({ node }) => node.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    const staleStatusText = loadError
        ? t("couldNotRefreshMemories", { error: loadError })
        : t("refreshingMemories");
    const selectionLabel = selectedCount > 0
        ? t("selectionAria", {
            selectedCount: tp("selectedMemory", selectedCount, { formattedCount: formatNumber(selectedCount) }),
            visibleNumber: formatNumber(visibleIds.length),
            visibleEntities: visibleIds.length === 1 ? t("memoryNoun") : t("memoriesNoun"),
        })
        : t("noMemoriesSelected");
    const visibleScopeParts = [
        t(activeTier.value === "short_term" ? "visibleScopeShort" : "visibleScopeLong"),
        activeTier.value === "short_term"
            ? (selectedSprintId ? t("visibleScopeSprint", { id: selectedSprintId }) : t("visibleScopeAllSprints"))
            : t("visibleScopeProject"),
        selectedAgentPresetId ? t("visibleScopeAgent", { id: selectedAgentPresetId }) : t("visibleScopeAllAgents"),
        query ? t("visibleScopeSearch", { query }) : t("visibleScopeNoSearch"),
    ];
    const visibleScopeLabel = visibleScopeParts.join(", ");

    const handleVisibleSelect = () => {
        if (allVisibleSelected || visibleIds.length === 0 || isDeleting) {
            return;
        }
        selectVisibleMemoryIds(visibleIds);
    };

    const handleRetry = async () => {
        if (!onRetry || retryPending) {
            return;
        }

        setRetryPending(true);
        try {
            await onRetry();
        } finally {
            setRetryPending(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedCount === 0 || isDeleting) return;

        const confirmed = await requestConfirm({
            title: t("deleteSelectedTitle"),
            body: t("deleteSelectedBody", { selectedCount: tp("selectedMemoryObject", selectedCount, { formattedCount: formatNumber(selectedCount) }), scope: visibleScopeLabel }),
            confirmLabel: t(selectedCount === 1 ? "deleteMemory" : "deleteMemories"),
            cancelLabel: t("cancel"),
            destructive: true,
        });

        if (!confirmed) {
            requestAnimationFrame(() => {
                const target = selectAllRef.current || listRef.current?.querySelector<HTMLElement>('[role="option"]');
                target?.focus();
            });
            return;
        }

        const idsToDelete = [...selectedIds];
        setBatchDeletePending(true);
        try {
            await memoryMutationsSignal.value.removeMemories(idsToDelete);
        } finally {
            setBatchDeletePending(false);
            requestAnimationFrame(() => {
                const target = selectAllRef.current || listRef.current?.querySelector<HTMLElement>('[role="option"]');
                target?.focus();
            });
        }
    };

    if (renderedNodes.length === 0) {
        const isEmpty = totalAliveCount === 0;
        const message = loadError ? t("couldNotRefreshList", { entity: entityTitle }) : isEmpty ? t("noEntitiesExist", { entities: entityPlural }) : t("noEntitiesMatch", { entities: entityPlural });
        return (
            <div
                id="memory-panel"
                aria-labelledby={`tab-${activeTier.value}`}
                className="flex min-h-0 min-w-0 flex-col items-center justify-center p-8 text-center text-slate-400"
                role="listbox"
                aria-label={t(entityLabel === "skill" ? "skillList" : "memoryList")}
                aria-busy={refreshing || isDeleting}
            >
                <div className="sr-only" aria-live={loadError ? "assertive" : "polite"} aria-atomic="true">
                    <span>{message}</span>
                    <span>. {t("showingZeroOf", { total: formatNumber(totalAliveCount), entities: entityPlural })}</span>
                </div>
                {loadError ? (
                    <RefreshCw className="mb-2 h-7 w-7 text-status-red/70" aria-hidden="true" />
                ) : (
                    <SearchX className="mb-2 h-7 w-7 text-slate-400/70" aria-hidden="true" />
                )}
                <p className="max-w-full break-words text-sm font-medium">{message}</p>
                <p className="mt-2 max-w-full break-words text-xs font-medium text-slate-400 dark:text-slate-500">
                    {loadError
                        ? loadError
                        : isEmpty
                            ? entityLabel === "skill" ? t("emptySkillList") : t("emptyMemoryList")
                            : t("clearOrAdjustFilters", { querySuffix: query ? t("querySuffix", { query }) : "" })}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {loadError && onRetry && (
                        <button
                            type="button"
                            onClick={() => { void handleRetry(); }}
                            disabled={retryPending}
                            aria-busy={retryPending}
                            style={controlTransitionStyle}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-status-red/20 bg-status-red/[0.08] px-3 py-1.5 text-[11px] font-bold text-status-red transition-colors hover:bg-status-red/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-void-900"
                        >
                            <RefreshCw size={13} className={retryPending ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
                            {retryPending ? t("retrying") : t("retry")}
                        </button>
                    )}
                    {!loadError && !isEmpty && query && (
                        <button
                            type="button"
                            onClick={() => { searchQuerySignal.value = ""; }}
                            style={controlTransitionStyle}
                            className="rounded-lg border border-black/[0.06] bg-black/[0.04] px-3 py-1.5 text-[11px] font-bold text-slate-500 transition-colors hover:bg-black/[0.08] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                        >
                            {t("clearSearch")}
                        </button>
                    )}
                    {!loadError && isEmpty && onAddMemory && (
                        <button
                            type="button"
                            onClick={onAddMemory}
                            style={controlTransitionStyle}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-signal-500/20 bg-signal-500/[0.1] px-3 py-1.5 text-[11px] font-bold text-signal-600 transition-colors hover:bg-signal-500/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-signal-300 dark:focus-visible:ring-offset-void-900"
                        >
                            <Plus size={13} aria-hidden="true" />
                            {t("addMemoryLower")}
                        </button>
                    )}
                </div>
                {!isEmpty && !loadError && (
                    <p className="mt-2 max-w-full break-words text-xs font-medium text-slate-400 dark:text-slate-500">
                        {t("showingResults", { shown: formatNumber(0), total: formatNumber(totalAliveCount), entities: entityPlural, querySuffix: query ? t("querySuffix", { query }) : "", staleSuffix: "" })}
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
            aria-label={t(entityLabel === "skill" ? "skillList" : "memoryList")}
            aria-describedby="memory-list-status memory-list-selection-status"
            aria-busy={refreshing || isDeleting}
        >
            <div id="memory-list-status" className="sr-only" aria-live="polite" aria-atomic="true">
                {countLabel}
                {searchQuerySignal.value.trim() ? t("querySuffix", { query: searchQuerySignal.value.trim() }) : ""}
                {refreshing ? `. ${t("refreshingResults")}` : ""}
                {loadError ? `. ${t("refreshFailedLastUseful")}` : ""}
            </div>
            <div id="memory-list-selection-status" className="sr-only" aria-live="polite" aria-atomic="true">
                {selectionLabel}
            </div>
            <div className="sticky top-0 z-10 flex min-w-0 flex-col gap-2">
                <div className="inline-flex max-w-full items-center gap-1.5 self-start rounded-lg border border-black/[0.04] bg-black/[0.02] px-2 py-1 text-xs font-medium text-slate-500 dark:border-white/[0.04] dark:bg-white/[0.02] dark:text-slate-400">
                    <span className="truncate">
                        {t("showingResults", { shown: formatNumber(resultCount), total: formatNumber(totalAliveCount), entities: entityPlural, querySuffix: searchQuerySignal.value.trim() ? t("querySuffix", { query: searchQuerySignal.value.trim() }) : "", staleSuffix: isShowingStaleResults ? t("lastUsefulList") : "" })}
                    </span>
                </div>
                {(refreshing || loadError || isShowingStaleResults) && (
                    <div
                        className={`flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold leading-4 ${
                            loadError
                                ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
                                : "border-signal-500/18 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                        }`}
                        role={loadError ? "alert" : "status"}
                        aria-live={loadError ? "assertive" : "polite"}
                    >
                        <RefreshCw size={13} className={refreshing && !loadError ? "mt-0.5 shrink-0 motion-safe:animate-spin" : "mt-0.5 shrink-0"} aria-hidden="true" />
                        <span className="min-w-0 break-words">
                            {staleStatusText}
                        </span>
                        {loadError && onRetry && (
                            <button
                                type="button"
                                onClick={() => { void handleRetry(); }}
                                disabled={retryPending}
                                aria-busy={retryPending}
                                style={controlTransitionStyle}
                                className="ml-auto shrink-0 rounded-md border border-status-red/25 px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-status-red/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-void-900"
                            >
                                {retryPending ? t("retrying") : t("retry")}
                            </button>
                        )}
                    </div>
                )}
                {!readOnly && <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                        ref={selectAllRef}
                        type="button"
                        onClick={handleVisibleSelect}
                        disabled={visibleIds.length === 0 || allVisibleSelected || isDeleting}
                        title={isDeleting ? t("selectionDeleteLocked") : allVisibleSelected ? t("selectAllAlready") : undefined}
                        style={controlTransitionStyle}
                        className="rounded-lg border border-black/[0.06] bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-black/[0.08] hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                        {t(allVisibleSelected ? "allVisibleSelected" : "selectAllVisible", { count: formatNumber(visibleIds.length) })}
                    </button>
                    {selectedCount > 0 && (
                        <div className={`inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] ${
                            isDeleting
                                ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
                                : "border-signal-500/20 bg-signal-500/[0.08] text-signal-500"
                        }`} style={asyncTransitionStyle} aria-busy={isDeleting}>
                            <span>{t("selectionSummary", { selected: formatNumber(selectedCount), visible: formatNumber(visibleIds.length) })}</span>
                            <button
                                type="button"
                                onClick={clearSelectedMemoryIds}
                                disabled={isDeleting}
                                title={isDeleting ? t("selectionCannotClear") : undefined}
                                style={controlTransitionStyle}
                                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            >
                                {t("clear")}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleBatchDelete(); }}
                                disabled={isDeleting}
                                aria-busy={isDeleting}
                                aria-describedby="memory-list-selection-status"
                                title={isDeleting ? t("deletingSelectedWait") : t("deletesRequireConfirmation")}
                                style={controlTransitionStyle}
                                className="inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 rounded-md bg-status-red px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-status-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-void-900"
                            >
                                {isDeleting && <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />}
                                {isDeleting ? t("deletingCount", { count: formatNumber(selectedCount) }) : selectedCount > 1 ? t("deleteCountSelected", { count: formatNumber(selectedCount) }) : t("deleteSelected")}
                            </button>
                        </div>
                    )}
                </div>}
                {!readOnly && <ActionFeedbackRegion
                    status={mutationFeedback?.status || "idle"}
                    message={mutationFeedback?.message}
                    onDismiss={memoryMutationsSignal.value.clearFeedback}
                    clearError={memoryMutationsSignal.value.clearError}
                    retryAction={mutationFeedback?.retryAction}
                    retryLabel={mutationFeedback?.retryLabel}
                />}
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
                            readOnly={readOnly}
                            entityLabel={entityLabel}
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
