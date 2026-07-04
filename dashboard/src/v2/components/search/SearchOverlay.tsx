import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { Search, X, Layers, Activity, Cpu, Box, Inbox, Loader2, FileX } from "lucide-preact";
import { useNavigate, Link } from "@tanstack/react-router";
import { SearchResultRow } from "./SearchResultRow";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";


export type SearchItem = { id: string; title?: string; name?: string; status?: string; sprint?: string; sprintId?: string; avatarConfig?: any };

export interface SearchResults {
    sprints: SearchItem[];
    tasks: SearchItem[];
    agents: SearchItem[];
    containers: SearchItem[];
}

interface SearchOverlayProps {
    anchorRef?: preact.RefObject<HTMLDivElement | null>;
    isLoading?: boolean;
    isOpen: boolean;
    onClose: () => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    results: SearchResults;
    hasProjectData?: boolean;
}

export const SearchOverlay: FunctionComponent<SearchOverlayProps> = ({ anchorRef, isOpen, onClose, searchQuery, onSearchChange, results, isLoading, hasProjectData = true }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerElementRef = useRef<HTMLElement | null>(null);
    const containerRef = useFocusTrap(isOpen, {
        onClose,
        initialFocusRef: inputRef,
        restoreFocus: true
    }) as preact.RefObject<HTMLDivElement>;
    const [focusedIndex, setFocusedIndex] = useState(-1);
            const navigate = useNavigate();

    const handleSelect = (selectedItem: SearchItem & { category?: string }) => {
        if (selectedItem) {
            if (selectedItem.category === 'sprints') {
                const match = selectedItem.title?.match(/^(SPR-\d+):/);
                const sprintKey = match ? match[1] : undefined;
                navigate({ to: '/sprints', search: { sprintId: selectedItem.id, sprintKey } as any });
            }
            else if (selectedItem.category === 'tasks') navigate({ to: '/tasks', search: { taskId: selectedItem.id, sprintId: selectedItem.sprintId } as any });
            else if (selectedItem.category === 'agents') navigate({ to: '/agents', search: { agentId: selectedItem.id } as any });
            else if (selectedItem.category === 'containers') navigate({ to: '/browser', search: { containerId: selectedItem.id } as any });
        }
        onClose();
    };

    const CATEGORIES: Array<{ id: string; title: string; icon: any; items: ReadonlyArray<SearchItem> }> = [
        { id: 'sprints', title: 'Sprints', icon: Layers, items: results?.sprints || [] },
        { id: 'tasks', title: 'Tasks', icon: Activity, items: results?.tasks || [] },
        { id: 'agents', title: 'Agents', icon: Cpu, items: results?.agents || [] },
        { id: 'containers', title: 'Preview Containers', icon: Box, items: results?.containers || [] }
    ];

    const allItems = CATEGORIES.flatMap(c => c.items?.map(item => ({ ...item, category: c.id })));
    const reducedMotion = useReducedMotion();

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
            const top = rect.bottom + 8;
            let left = rect.left;

            // max width is around 800px or full viewport
            const modalWidth = Math.min(800, window.innerWidth - 32);
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
            if (!triggerElementRef.current) {
                triggerElementRef.current = document.activeElement as HTMLElement;
            }
            gsap.set(overlayRef.current, { display: 'flex' });

            const tl = gsap.timeline();

            tl.fromTo(overlayRef.current,
                { opacity: 0 },
                { opacity: 1, duration: reducedMotion ? 0 : MODAL_MOTION.overlay.entry, ease: MODAL_MOTION.overlay.entryEase }
            );

            tl.fromTo(containerRef.current,
                { y: reducedMotion ? 0 : -20, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: reducedMotion ? 0 : MODAL_MOTION.overlay.cardEntry,
                    ease: MODAL_MOTION.overlay.cardEntryEase,
                    onComplete: () => inputRef.current?.focus()
                },
                reducedMotion ? 0 : "-=0.2"
            );
        } else {
            const tl = gsap.timeline({
                onComplete: () => {
                    if (overlayRef.current) {
                        gsap.set(overlayRef.current, { display: 'none' });
                    }
                    triggerElementRef.current = null;
                }
            });

            if (containerRef.current) {
                tl.to(containerRef.current, { y: reducedMotion ? 0 : -20, opacity: 0, duration: reducedMotion ? 0 : MODAL_MOTION.overlay.exit, ease: MODAL_MOTION.overlay.exitEase });
            }
            tl.to(overlayRef.current, { opacity: 0, duration: reducedMotion ? 0 : MODAL_MOTION.overlay.exit, ease: MODAL_MOTION.overlay.exitEase }, reducedMotion ? 0 : "-=0.1");

            setFocusedIndex(-1);
        }
    }, [isOpen, reducedMotion]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'Home') {
                e.preventDefault();
                setFocusedIndex(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                setFocusedIndex((allItems?.length || 0) - 1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(prev => (prev < (allItems?.length || 0) - 1 ? prev + 1 : 0));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(prev => (prev > 0 ? prev - 1 : (allItems?.length || 0) - 1));
            } else if (e.key === 'Enter' && focusedIndex >= 0) {
                e.preventDefault();
                const selectedItem = allItems[focusedIndex];
                if (selectedItem) {
                    handleSelect(selectedItem);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, focusedIndex, allItems?.length || 0, onClose]);

    // Track active item ref to ensure it's in view
    const activeItemRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (activeItemRef.current && typeof activeItemRef.current.closest === 'function') {
            const el = activeItemRef.current;
            const container = el.closest('.overflow-y-auto') as HTMLElement;
            if (container) {
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                if (elRect.bottom > containerRect.bottom) {
                    container.scrollTop += (elRect.bottom - containerRect.bottom);
                } else if (elRect.top < containerRect.top) {
                    container.scrollTop -= (containerRect.top - elRect.top);
                }
            } else if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [focusedIndex]);


    let globalItemIndex = 0;

    return (
        <div
            ref={overlayRef}
            className={anchorRef && !isMobileFallback ? "fixed inset-0 z-[100] hidden items-start justify-center px-4 sm:px-6 sm:pt-16" : "fixed inset-0 z-[100] hidden items-start justify-center px-4 pt-4 sm:px-6 sm:pt-16"}
            style={{ display: 'none' }}
        >
            <div
                className="absolute inset-0 cursor-pointer bg-void-900/50 backdrop-blur-sm"
                onClick={onClose}
            />

            <div
                role="dialog"
                aria-label="Search"
                aria-modal="true"
                ref={containerRef}
                className={anchorRef && !isMobileFallback ? "flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)]" : "relative mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)]"}
                style={anchorRef && !isMobileFallback ? modalStyle : {}}
            >
                {/* Search Header */}
                <div className="flex items-center border-b border-black/[0.06] bg-white/95 px-3 py-3 dark:border-white/[0.08] dark:bg-void-800/95 sm:px-4 sm:py-4">
                    <Search className="mr-3 h-5 w-5 shrink-0 text-slate-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={isOpen}
                        aria-controls="search-results-list"
                        aria-activedescendant={!isLoading && focusedIndex >= 0 ? `search-result-${allItems[focusedIndex]?.id}` : undefined}
                        aria-label="Global search"
                        placeholder="Search sprints, tasks, agents..."
                        value={searchQuery}
                        onInput={(e) => onSearchChange(e.currentTarget.value)}
                        className="min-w-0 flex-1 border-none bg-transparent text-base text-slate-900 outline-none placeholder-slate-400 dark:text-white sm:text-lg"
                    />
                    {isLoading && <Loader2 className="mr-2 h-5 w-5 shrink-0 motion-safe:animate-spin text-slate-400 motion-reduce:animate-none" />}
                    <button
                        onClick={onClose}
                        aria-label="Close search"
                        className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="sr-only" role="status" aria-live="polite">
                    {searchQuery.length === 0 ? '' : isLoading ? 'Searching...' : allItems.length === 0 ? (!hasProjectData ? `Project data unavailable for '${searchQuery}'` : `No results found for '${searchQuery}'`) : `${allItems.length} results available`}
                </div>

                {/* Results Area */}
                <div className="dashboard-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                    {searchQuery.length === 0 ? (
                        <div className="flex flex-col">
                            <h3 className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                Quick navigation
                            </h3>
                            <div className="flex flex-wrap gap-2 px-3 pb-4">
                                <Link
                                    to="/sprints"
                                    onClick={onClose}
                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Layers className="w-4 h-4" />
                                    Sprints
                                </Link>
                                <Link
                                    to="/tasks"
                                    onClick={onClose}
                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Activity className="w-4 h-4" />
                                    Tasks
                                </Link>
                                <Link
                                    to="/agents"
                                    onClick={onClose}
                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                                >
                                    <Cpu className="w-4 h-4" />
                                    Agents
                                </Link>
                            </div>
                        </div>
                    ) : allItems.length === 0 && !isLoading ? (
                        !hasProjectData ? (
                            <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-slate-500 dark:text-slate-400" aria-live="polite" role="status">
                                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-status-red/20 bg-status-red/10 text-status-red">
                                    <FileX className="h-5 w-5" />
                                </div>
                                <span className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">Project data unavailable</span>
                                <span className="mt-1 max-w-sm break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">Unable to load project search results.</span>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-slate-500 dark:text-slate-400" aria-live="polite" role="status">
                                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] bg-black/[0.03] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.05]">
                                    <Inbox className="h-5 w-5" />
                                </div>
                                <span className="max-w-full break-words text-sm font-semibold text-slate-900 dark:text-slate-100">No results found for '{searchQuery}'</span>
                                <span className="mt-1 max-w-sm break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">Try adjusting your search terms or checking for typos.</span>
                            </div>
                        )
                    ) : (
                        <div id="search-results-list" role="listbox" className={`grid grid-cols-1 gap-3 p-1 transition-opacity duration-200 lg:grid-cols-2 lg:gap-4 sm:p-2 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            {CATEGORIES.map((category) => {
                                if (category.items?.length === 0) return null;
                                return (
                                    <div key={category.id} className="flex flex-col">
                                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <category.icon className="w-4 h-4" />
                                                <span className="truncate">{category.title}</span>
                                            </div>
                                            <span className="text-[10px] font-mono opacity-60 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded-md">
                                                {category.items.length}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
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
                                                        onFocus={() => setFocusedIndex(currentIndex)}
                                                        activeItemRef={isFocused ? activeItemRef : null}
                                                        onClick={() => handleSelect({ ...item, category: category.id })}
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
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-void-50/80 px-4 py-3 text-xs text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <div className="flex flex-wrap items-center gap-4">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded-md bg-white dark:bg-void-800 border border-black/10 dark:border-white/10 shadow-sm font-mono text-[10px]">↑</kbd>
                            <kbd className="px-1.5 py-0.5 rounded-md bg-white dark:bg-void-800 border border-black/10 dark:border-white/10 shadow-sm font-mono text-[10px]">↓</kbd>
                            <span>to navigate</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded-md bg-white dark:bg-void-800 border border-black/10 dark:border-white/10 shadow-sm font-mono text-[10px]">↵</kbd>
                            <span>to select</span>
                        </span>
                    </div>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded-md bg-white dark:bg-void-800 border border-black/10 dark:border-white/10 shadow-sm font-mono text-[10px]">esc</kbd>
                        <span>to close</span>
                    </span>
                </div>
            </div>
        </div>
    );
};
