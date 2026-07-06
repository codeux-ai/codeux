import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { Search, X, Layers, Activity, Cpu, Box, Inbox, Loader2, FileX, ArrowDownUp, CornerDownLeft, Sparkles } from "lucide-preact";
import { useNavigate, Link } from "@tanstack/react-router";
import { SearchResultRow } from "./SearchResultRow";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import type { AgentAvatarConfig } from "../../types.js";


export interface SprintSearchItem {
    id: string;
    title: string;
    displayKey: string;
    sprintKey: string;
    routeSprintId: string;
    status?: string;
}

export interface TaskSearchItem {
    id: string;
    title: string;
    sprint?: string;
    sprintId?: string;
    routeTaskId: string;
    routeSprintId?: string;
    status?: string;
}

export interface AgentSearchItem {
    id: string;
    name: string;
    routeAgentId: string;
    status?: string;
    avatarConfig?: AgentAvatarConfig | null;
}

export interface ContainerSearchItem {
    id: string;
    name: string;
    routeContainerId: string;
    status?: string;
}

export type SearchItem = SprintSearchItem | TaskSearchItem | AgentSearchItem | ContainerSearchItem;
export type SearchCategoryId = "sprints" | "tasks" | "agents" | "containers";
type CategorizedSearchItem =
    | (SprintSearchItem & { category: "sprints" })
    | (TaskSearchItem & { category: "tasks" })
    | (AgentSearchItem & { category: "agents" })
    | (ContainerSearchItem & { category: "containers" });

const inactiveResultStatuses = new Set(["unavailable", "disabled"]);
const searchResultViewportPadding = 8;

function isResultInactive(item: SearchItem): boolean {
    return Boolean(item.status && inactiveResultStatuses.has(item.status));
}

function findNextActiveIndex(items: CategorizedSearchItem[], startIndex: number, direction: 1 | -1): number {
    if (items.length === 0) return -1;

    let index = startIndex;
    for (let checked = 0; checked < items.length; checked += 1) {
        if (index < 0) index = items.length - 1;
        if (index >= items.length) index = 0;
        if (!isResultInactive(items[index])) return index;
        index += direction;
    }

    return 0;
}

function getNextKeyboardIndex(items: CategorizedSearchItem[], currentIndex: number, direction: 1 | -1): number {
    if (items.length === 0) return -1;
    const startIndex = direction === 1
        ? currentIndex < items.length - 1 ? currentIndex + 1 : 0
        : currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    return findNextActiveIndex(items, startIndex, direction);
}

function scrollResultIntoContainerView(container: HTMLElement, row: HTMLElement): void {
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const bottomOverflow = rowRect.bottom - containerRect.bottom + searchResultViewportPadding;
    const topOverflow = containerRect.top - rowRect.top + searchResultViewportPadding;

    if (bottomOverflow > 0) {
        container.scrollTop += bottomOverflow;
    } else if (topOverflow > 0) {
        container.scrollTop -= topOverflow;
    }
}

export interface SearchResults {
    sprints: SprintSearchItem[];
    tasks: TaskSearchItem[];
    agents: AgentSearchItem[];
    containers: ContainerSearchItem[];
}

interface SearchOverlayProps {
    anchorRef?: preact.RefObject<HTMLDivElement | null>;
    committedSearchQuery?: string;
    isLoading?: boolean;
    isOpen: boolean;
    onClose: () => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    results: SearchResults;
    hasProjectData?: boolean;
}

export const SearchOverlay: FunctionComponent<SearchOverlayProps> = ({ anchorRef, committedSearchQuery, isOpen, onClose, searchQuery, onSearchChange, results, isLoading, hasProjectData = true }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRegionRef = useRef<HTMLDivElement>(null);
    const containerRef = useFocusTrap(isOpen, {
        onClose,
        initialFocusRef: inputRef,
        restoreFocus: true
    }) as preact.RefObject<HTMLDivElement>;
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const navigate = useNavigate();
    const gsapTokens = useGsapInteractionTokens();
    const interactionTokens = useInteractionTokens();
    const enterExitDuration = gsapTokens.enterExit.duration;
    const enterExitEase = gsapTokens.enterExit.ease;
    const controlFeedbackDuration = gsapTokens.controlFeedback.duration;
    const controlFeedbackEase = gsapTokens.controlFeedback.ease;
    const listRevealDuration = gsapTokens.listReveal.duration;
    const listRevealEase = gsapTokens.listReveal.ease;

    const handleSelect = (selectedItem: CategorizedSearchItem) => {
        if (isResultInactive(selectedItem)) return;

        if (selectedItem) {
            if (selectedItem.category === 'sprints') {
                navigate({ to: '/sprints', search: { sprintId: selectedItem.routeSprintId, sprintKey: selectedItem.sprintKey } as any });
            }
            else if (selectedItem.category === 'tasks') navigate({ to: '/tasks', search: { taskId: selectedItem.routeTaskId, sprintId: selectedItem.routeSprintId } as any });
            else if (selectedItem.category === 'agents') navigate({ to: '/agents', search: { agentId: selectedItem.routeAgentId } as any });
            else if (selectedItem.category === 'containers') navigate({ to: '/browser', search: { containerId: selectedItem.routeContainerId } as any });
        }
        onClose();
    };

    const CATEGORIES: Array<{ id: SearchCategoryId; title: string; icon: any; items: ReadonlyArray<SearchItem> }> = [
        { id: 'sprints', title: 'Sprints', icon: Layers, items: results?.sprints || [] },
        { id: 'tasks', title: 'Tasks', icon: Activity, items: results?.tasks || [] },
        { id: 'agents', title: 'Agents', icon: Cpu, items: results?.agents || [] },
        { id: 'containers', title: 'Preview Containers', icon: Box, items: results?.containers || [] }
    ];

    const allItems: CategorizedSearchItem[] = useMemo(
        () => CATEGORIES.flatMap(c => c.items?.map(item => ({ ...item, category: c.id } as CategorizedSearchItem))),
        [results?.sprints, results?.tasks, results?.agents, results?.containers]
    );
    const activeItem = focusedIndex >= 0 ? allItems[focusedIndex] : undefined;
    const activeDescendantId = activeItem ? `search-result-${activeItem.id}` : undefined;
    const hasResults = allItems.length > 0;
    const hasStaleResults = Boolean(isLoading && hasResults);
    const committedQuery = committedSearchQuery ?? searchQuery;
    const visibleResultQuery = hasStaleResults && committedQuery.trim().length > 0 ? committedQuery : searchQuery;
    const resultsDescriptionId = hasStaleResults ? "search-results-refreshing-note" : "search-status-message";
    // current results remain available while a background refresh keeps stale items on screen.
    const statusMessage = searchQuery.length === 0
        ? ''
        : isLoading
            ? hasResults
                    ? `Updating results for '${searchQuery}'. ${allItems.length} current ${allItems.length === 1 ? "result remains" : "results remain"} available.`
                : 'Searching workspace'
            : allItems.length === 0
                ? (!hasProjectData ? `Project data unavailable for '${searchQuery}'` : `No results found for '${visibleResultQuery}'`)
                : `${allItems.length} results available`;

    const [modalStyle, setModalStyle] = useState({});
    const [isMobileFallback, setIsMobileFallback] = useState(false);

    const updatePosition = () => {
        if (anchorRef && anchorRef.current && isOpen) {
            const rect = anchorRef.current.getBoundingClientRect();
            // Fallback to centered mobile mode if narrow screen or insufficient height
            if (window.innerWidth < 768 || window.innerHeight - rect.bottom < 300) {
                setIsMobileFallback(true);
                return;
            }

            setIsMobileFallback(false);
            const top = rect.bottom + 10;
            let left = rect.left;

            // max width is around 800px or full viewport
            const modalWidth = Math.min(760, window.innerWidth - 32);
            if (left + modalWidth > window.innerWidth - 16) {
                left = window.innerWidth - modalWidth - 16;
            }
            if (left < 16) left = 16;

            setModalStyle({
                position: 'fixed',
                top: `${top}px`,
                left: `${left}px`,
                width: `${modalWidth}px`,
                maxHeight: `calc(100dvh - ${top + 16}px)`
            });
        } else if (!anchorRef && isOpen) {
            setIsMobileFallback(false);
            setModalStyle({});
        }
    };


    useLayoutEffect(() => {
        updatePosition();
    }, [isOpen, anchorRef]);

    useEffect(() => {
        if (!isOpen) return;
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, anchorRef]);

    useLayoutEffect(() => {
        if (!overlayRef.current || !containerRef.current) return;

        gsap.killTweensOf(overlayRef.current);
        gsap.killTweensOf(containerRef.current);

        if (isOpen) {
            gsap.set(overlayRef.current, { display: 'flex' });

            const tl = gsap.timeline();

            tl.fromTo(overlayRef.current,
                { opacity: 0 },
                { opacity: 1, duration: enterExitDuration, ease: enterExitEase }
            );

            tl.fromTo(containerRef.current,
                { y: listRevealDuration === 0 ? 0 : -20, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: listRevealDuration,
                    ease: listRevealEase,
                    onComplete: () => inputRef.current?.focus()
                },
                controlFeedbackDuration === 0 ? 0 : `-=${controlFeedbackDuration}`
            );
        } else {
            const tl = gsap.timeline({
                onComplete: () => {
                    if (overlayRef.current) {
                        gsap.set(overlayRef.current, { display: 'none' });
                    }
                }
            });

            if (containerRef.current) {
                tl.to(containerRef.current, {
                    y: enterExitDuration === 0 ? 0 : -20,
                    opacity: 0,
                    duration: enterExitDuration,
                    ease: enterExitEase
                });
            }
            tl.to(overlayRef.current, {
                opacity: 0,
                duration: controlFeedbackDuration,
                ease: controlFeedbackEase
            }, controlFeedbackDuration === 0 ? 0 : `-=${controlFeedbackDuration}`);

            setFocusedIndex(-1);
        }
    }, [isOpen, enterExitDuration, enterExitEase, controlFeedbackDuration, controlFeedbackEase, listRevealDuration, listRevealEase]);

    useEffect(() => {
        setFocusedIndex(prev => {
            if (allItems.length === 0) return -1;
            if (prev >= allItems.length) return findNextActiveIndex(allItems, allItems.length - 1, -1);
            if (prev >= 0 && isResultInactive(allItems[prev])) return findNextActiveIndex(allItems, prev + 1, 1);
            return prev;
        });
    }, [allItems]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;
            const itemCount = allItems.length;

            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'Home') {
                e.preventDefault();
                setFocusedIndex(findNextActiveIndex(allItems, 0, 1));
            } else if (e.key === 'End') {
                e.preventDefault();
                setFocusedIndex(findNextActiveIndex(allItems, itemCount - 1, -1));
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(prev => getNextKeyboardIndex(allItems, prev, 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(prev => getNextKeyboardIndex(allItems, prev, -1));
            } else if (e.key === 'Enter' && focusedIndex >= 0) {
                e.preventDefault();
                const selectedItem = allItems[focusedIndex];
                if (selectedItem && !isResultInactive(selectedItem)) {
                    handleSelect(selectedItem);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, focusedIndex, allItems, onClose]);

    const activeItemRef = useRef<HTMLAnchorElement>(null);
    useEffect(() => {
        const el = (activeDescendantId ? document.getElementById(activeDescendantId) as HTMLAnchorElement | null : null) ?? activeItemRef.current;
        const container = resultsRegionRef.current;
        if (el && container && typeof el.getBoundingClientRect === 'function') {
            scrollResultIntoContainerView(container, el);
        }
    }, [focusedIndex, activeDescendantId]);


    let globalItemIndex = 0;

    return (
        <div
            ref={overlayRef}
            className={anchorRef && !isMobileFallback ? "fixed inset-0 z-[100] hidden items-start justify-center px-3 sm:px-6 sm:pt-16" : "fixed inset-0 z-[100] hidden items-start justify-center px-3 pt-14 sm:px-6 sm:pt-16"}
            style={{ display: 'none' }}
        >
            <div
                className="absolute inset-0 cursor-pointer bg-void-900/72 backdrop-blur-3xl dark:bg-void-900/88"
                onClick={onClose}
            />

            <div
                role="dialog"
                aria-label="Search"
                aria-modal="true"
                ref={containerRef}
                className={anchorRef && !isMobileFallback ? "flex flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.08] bg-white/92 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-void-800/94 dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)]" : "relative mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.08] bg-white/92 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-void-800/94 dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)]"}
                style={anchorRef && !isMobileFallback ? modalStyle : {}}
            >
                {/* Search Header */}
                <div className="flex min-h-[72px] items-center gap-3 border-b border-black/[0.06] bg-[#F9F8F4]/72 px-4 py-3 dark:border-white/[0.06] dark:bg-void-900/32 sm:px-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/70 text-slate-500 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300">
                        <Search className="h-[18px] w-[18px]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <label htmlFor="global-search-input" className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                            Global search
                        </label>
                        <input
                            id="global-search-input"
                            ref={inputRef}
                            type="text"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={isOpen}
                            aria-controls="search-results-list"
                            aria-activedescendant={activeDescendantId}
                            aria-busy={isLoading ? "true" : undefined}
                            aria-label="Global search"
                            placeholder="Find sprints, tasks, agents, previews..."
                            value={searchQuery}
                            onInput={(e) => onSearchChange(e.currentTarget.value)}
                            className="w-full min-w-0 border-none bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500 sm:text-lg"
                        />
                    </div>
                    {isLoading && <Loader2 className="mr-1 h-5 w-5 shrink-0 animate-spin text-slate-400 motion-reduce:animate-none" aria-label={hasStaleResults ? "Updating search results" : "Searching"} />}
                    <button
                        onClick={onClose}
                        aria-label="Close search"
                        style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                        className="ml-0 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
                    >
                        <X className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                </div>

                <div id="search-status-message" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {statusMessage}
                </div>

                {/* Results Area */}
                <div
                    ref={resultsRegionRef}
                    className="dashboard-scrollbar min-h-0 flex-1 overflow-y-auto p-3 transition-[background-color,filter] sm:p-4"
                    aria-busy={isLoading ? "true" : undefined}
                    aria-describedby={searchQuery.length > 0 ? resultsDescriptionId : undefined}
                    style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                >
                    {searchQuery.length === 0 ? (
                        <div className="flex flex-col gap-4">
                            <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                                    Quick navigation
                                </div>
                                <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    Search by sprint key, task ID, provider name, agent name, preview container, or status.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <Link
                                    to="/sprints"
                                    onClick={onClose}
                                    className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-black/[0.06] bg-white/58 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white/86 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="truncate">Sprints</span>
                                </Link>
                                <Link
                                    to="/tasks"
                                    onClick={onClose}
                                    className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-black/[0.06] bg-white/58 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white/86 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="truncate">Tasks</span>
                                </Link>
                                <Link
                                    to="/agents"
                                    onClick={onClose}
                                    className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-black/[0.06] bg-white/58 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white/86 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="truncate">Agents</span>
                                </Link>
                            </div>
                        </div>
                    ) : isLoading && allItems.length === 0 ? (
                        <div className="flex min-h-52 flex-col items-center justify-center rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] px-6 py-12 text-center text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-400" aria-live="polite" role="status">
                            <Loader2 className="mb-4 h-8 w-8 animate-spin text-slate-400 motion-reduce:animate-none" aria-hidden="true" />
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Searching workspace</span>
                            <span className="mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">Checking sprints, tasks, agents, and preview containers.</span>
                        </div>
                    ) : allItems.length === 0 && !isLoading ? (
                        !hasProjectData ? (
                            <div className="flex min-h-52 flex-col items-center justify-center rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] px-6 py-12 text-center text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-400" aria-live="polite" role="status">
                                <FileX className="mb-4 h-8 w-8 text-status-red opacity-70" aria-hidden="true" />
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Project data unavailable</span>
                                <span className="mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">Unable to load project search results.</span>
                            </div>
                        ) : (
                            <div className="flex min-h-52 flex-col items-center justify-center rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] px-6 py-12 text-center text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-400" aria-live="polite" role="status">
                                <Inbox className="mb-4 h-8 w-8 opacity-55" aria-hidden="true" />
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">No results found for '{visibleResultQuery}'</span>
                                <span className="mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">Try a sprint key, task ID, provider, agent, or status.</span>
                            </div>
                        )
                    ) : (
                        <div
                            id="search-results-list"
                            role="listbox"
                            aria-busy={isLoading ? "true" : undefined}
                            aria-describedby={hasStaleResults ? "search-results-refreshing-note" : undefined}
                            aria-label="Search results"
                            style={{
                                transitionDuration: hasStaleResults ? interactionTokens.controlFeedback.duration : interactionTokens.listReveal.duration,
                                transitionTimingFunction: hasStaleResults ? interactionTokens.controlFeedback.ease : interactionTokens.listReveal.ease
                            }}
                            className={`relative grid grid-cols-1 gap-3 transition-[filter,opacity] lg:grid-cols-2 ${hasStaleResults ? 'opacity-[0.78] saturate-[0.82]' : ''}`}
                        >
                            {hasStaleResults && (
                                <div
                                    id="search-results-refreshing-note"
                                    className="pointer-events-none absolute right-1 top-1 z-10 inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-white/88 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-700 shadow-sm backdrop-blur-xl dark:bg-void-800/88 dark:text-signal-400"
                                >
                                    <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    Updating visible results
                                </div>
                            )}
                            {CATEGORIES.map((category) => {
                                if (category.items?.length === 0) return null;
                                return (
                                    <div key={category.id} className="flex min-w-0 flex-col gap-1.5">
                                        <div className="flex items-center justify-between gap-3 px-1.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <category.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                <span className="truncate">
                                                {category.title}
                                                </span>
                                            </div>
                                            <span className="shrink-0 rounded-md border border-black/[0.05] bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-slate-400">
                                                {category.items.length}
                                            </span>
                                        </div>
                                        <div className="flex min-w-0 flex-col gap-1.5">
                                            {category.items.map((item) => {
                                                const isFocused = focusedIndex === globalItemIndex;
                                                const currentIndex = globalItemIndex++;

                                                return (
                                                    <SearchResultRow
                                                        key={item.id}
                                                        item={item}
                                                        categoryType={category.id}
                                                        searchQuery={searchQuery}
                                                        globalItemIndex={currentIndex}
                                                        isFocused={isFocused}
                                                        onFocus={() => {
                                                            if (!isResultInactive(item)) setFocusedIndex(currentIndex);
                                                        }}
                                                        activeItemRef={isFocused ? activeItemRef : null}
                                                        onClick={() => handleSelect({ ...item, category: category.id } as CategorizedSearchItem)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer hints */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-[#F9F8F4]/72 px-4 py-3 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-void-900/32 sm:px-5">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1.5">
                            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Navigate</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <kbd className="rounded-md border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm dark:border-white/[0.1] dark:bg-void-800">Enter</kbd>
                            <span>Select</span>
                        </span>
                    </div>
                    <span className="flex items-center gap-1.5">
                        <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        <kbd className="rounded-md border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm dark:border-white/[0.1] dark:bg-void-800">Esc</kbd>
                        <span>Close</span>
                    </span>
                </div>
            </div>
        </div>
    );
};
