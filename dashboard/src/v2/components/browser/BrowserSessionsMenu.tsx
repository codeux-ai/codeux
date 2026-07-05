import type { FunctionComponent } from "preact";
import { useEffect, useState, useRef, useCallback } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { Compass, ExternalLink, Loader2, ServerOff, FolderArchive, Play, Square, AlertCircle } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { fetchPreviewSessions } from "../../lib/browser-api.js";
import { buildPreviewUrl, formatPreviewPortMappingsSummary, getPrimaryPreviewPortMapping } from "../../lib/preview-origin.js";
import type { SprintPreviewSession } from "../../../types.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";

type InteractionState = 'closed' | 'open';

const statusLabel: Record<SprintPreviewSession["status"], string> = {
    starting: "Starting",
    running: "Running",
    stopped: "Stopped",
    error: "Error",
};

const healthLabel: Record<SprintPreviewSession["healthStatus"], string> = {
    healthy: "Healthy",
    unreachable: "Unreachable",
    unknown: "Health unknown",
};

const menuTransition = buildInteractionTransition("listReorder");
const controlTransition = buildInteractionTransition("controlFeedback");

export const BrowserSessionsMenu: FunctionComponent<{ enabled?: boolean }> = ({ enabled = true }) => {
    const { selectedProject } = useProjectData();
    const [sessions, setSessions] = useState<SprintPreviewSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [interactionState, setInteractionState] = useState<InteractionState>('closed');
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const pendingMenuFocusRef = useRef<"first" | "last" | null>(null);
    const [menuId] = useState(() => `browser-menu-${Math.random().toString(36).substr(2, 9)}`);

    const isMenuVisible = interactionState !== 'closed';

    const getEnabledMenuItems = useCallback((): HTMLElement[] => {
        if (!containerRef.current) {
            return [];
        }
        return Array.from(
            containerRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')
        ) as HTMLElement[];
    }, []);

    const restoreTriggerFocus = useCallback(() => {
        const trigger = triggerRef.current;
        if (trigger && !trigger.disabled && trigger.isConnected) {
            trigger.focus({ preventScroll: true });
            return;
        }
        const fallback = document.querySelector<HTMLElement>('[data-overlay-focus-fallback], [data-focus-fallback], main, [role="main"], #root') || document.body;
        fallback.focus?.({ preventScroll: true });
    }, []);

    const closeMenu = useCallback((restoreFocus = true) => {
        setInteractionState('closed');
        if (restoreFocus) {
            queueMicrotask(restoreTriggerFocus);
        }
    }, [restoreTriggerFocus]);

    const loadSessions = useCallback(async () => {
        if (!selectedProject?.id) {
            setSessions([]);
            setLoadError(null);
            return;
        }
        try {
            setLoading(true);
            const data = await fetchPreviewSessions(selectedProject.id);
            setSessions(data || []);
            setLoadError(null);
        } catch (error) {
            console.error("Failed to fetch browser sessions:", error);
            setLoadError(error instanceof Error ? error.message : "Failed to fetch browser sessions.");
        } finally {
            setLoading(false);
        }
    }, [selectedProject?.id]);

    useEffect(() => {
        if (isMenuVisible) {
            void loadSessions();
        }
    }, [isMenuVisible, loadSessions]);

    const handleBlur = (e: FocusEvent) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            closeMenu(false);
        }
    };

    const toggleMenu = () => {
        setInteractionState((prev) => (prev === 'closed' ? 'open' : 'closed'));
    };

    const focusMenuItem = (position: "first" | "last"): boolean => {
        const items = getEnabledMenuItems();
        const item = position === "first" ? items[0] : items[items.length - 1];
        if (!item) {
            return false;
        }
        item.focus({ preventScroll: true });
        return true;
    };

    const openMenuFromKeyboard = (position: "first" | "last") => {
        pendingMenuFocusRef.current = position;
        setInteractionState('open');
    };

    const handleTriggerKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenuFromKeyboard("first");
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openMenuFromKeyboard("last");
        } else if (e.key === "Escape" && isMenuVisible) {
            e.preventDefault();
            closeMenu();
        }
    };

    const handleMenuKeyDown = (e: KeyboardEvent) => {
        if (!isMenuVisible) return;

        const items = getEnabledMenuItems();
        if (items.length === 0) return;

        const currentIndex = items.indexOf(document.activeElement as HTMLElement);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
            items[nextIndex]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
            items[prevIndex]?.focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1]?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
        }
    };

    useEffect(() => {
        if (!isMenuVisible || !pendingMenuFocusRef.current) {
            return;
        }
        const position = pendingMenuFocusRef.current;
        queueMicrotask(() => {
            if (focusMenuItem(position)) {
                pendingMenuFocusRef.current = null;
            }
        });
    }, [isMenuVisible, sessions, loading, getEnabledMenuItems]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isMenuVisible) {
                e.preventDefault();
                closeMenu();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [closeMenu, isMenuVisible]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isMenuVisible && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                closeMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeMenu, isMenuVisible]);

    if (!enabled) {
        return null;
    }

    return (
        <div
            className="relative hidden md:block"
            ref={containerRef}
            onBlur={handleBlur}
            onKeyDown={handleMenuKeyDown as any}
        >
            <button
                ref={triggerRef}
                type="button"
                data-tour-id="active-sessions"
                onClick={toggleMenu}
                onKeyDown={handleTriggerKeyDown as any}
                aria-haspopup="menu"
                aria-expanded={isMenuVisible}
                aria-controls={isMenuVisible ? menuId : undefined}
                aria-label={`Browser Sessions: ${sessions.length} active`}
                className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    isMenuVisible
                    ? "bg-signal-500/8 dark:bg-signal-400/10"
                    : "hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                }`}
                style={{ transition: controlTransition }}
            >
                <Compass aria-hidden="true" className={"w-4 h-4 transition-colors " + (isMenuVisible ? "text-signal-600 dark:text-signal-300" : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white")} strokeWidth={1.5} />
            </button>

            {isMenuVisible && (
                <div
                    role="menu"
                    id={menuId}
                    aria-label="Active Browser Sessions"
                    aria-busy={loading}
                    className="fixed inset-x-4 top-[72px] md:inset-auto md:absolute md:top-full md:right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50 flex flex-col"
                >
                    <div className="px-3 py-2 flex justify-between items-center shrink-0 border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active Sessions</span>
                        <Link
                            to="/browser"
                            onClick={() => closeMenu(false)}
                            className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 hover:text-signal-700 dark:text-signal-500 dark:hover:text-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-md px-1"
                        >
                            Open App
                        </Link>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto pb-1 flex flex-col" onKeyDown={handleMenuKeyDown as any}>
                        {(loading || loadError) && sessions.length > 0 && (
                            <div
                                className={`mx-3 mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${
                                    loadError
                                        ? "border-status-red/25 bg-status-red/10 text-status-red"
                                        : "border-ember-500/25 bg-ember-500/10 text-ember-700 dark:text-ember-300"
                                }`}
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                {loadError
                                    ? `Could not refresh sessions. Showing last loaded sessions. ${loadError}`
                                    : "Refreshing sessions. Current sessions remain available."}
                            </div>
                        )}
                        {loading && sessions.length === 0 ? (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3" role="status" aria-live="polite" aria-busy={loading}>
                                <Loader2 className="w-5 h-5 text-signal-500 animate-spin" />
                                <p className="text-xs text-slate-500 font-medium">Discovering active sessions...</p>
                            </div>
                        ) : sessions.length > 0 ? (
                            sessions.map((session, index) => {
                                const sprintName = session.sprintName || "Unknown Sprint";
                                const primaryMapping = getPrimaryPreviewPortMapping(session);
                                const canOpen = Boolean(primaryMapping?.hostPort);
                                const firstEnabledIndex = sessions.findIndex((candidate) => Boolean(getPrimaryPreviewPortMapping(candidate)?.hostPort));
                                const menuItemClassName = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex flex-col gap-1.5 px-3 py-3 text-left transition-colors group border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 ${
                                    canOpen
                                        ? "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                                        : "cursor-not-allowed bg-slate-500/[0.04]"
                                }`;
                                const content = (
                                    <>
                                    <div className="flex flex-wrap items-center justify-between min-w-0 w-full gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="flex items-center gap-1.5 shrink-0 bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 rounded-md">
                                                {session.status === 'starting' ? <Loader2 aria-hidden="true" className="w-3 h-3 animate-spin text-ember-500 motion-reduce:animate-none" /> : session.status === 'running' ? <Play aria-hidden="true" className="w-3 h-3 text-signal-500" fill="currentColor" /> : session.status === 'error' ? <AlertCircle aria-hidden="true" className="w-3 h-3 text-status-red" /> : <Square aria-hidden="true" className="w-3 h-3 text-slate-500" fill="currentColor" />}
                                                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{statusLabel[session.status]}</span>
                                            </div>
                                            <span className="min-w-0 break-words text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                {sprintName}
                                            </span>
                                        </div>
                                        {canOpen ? (
                                            <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-signal-500 transition-colors" />
                                        ) : (
                                            <span className="rounded-full border border-slate-400/25 bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-400">
                                                Link unavailable
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 min-w-0">
                                        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                            {healthLabel[session.healthStatus]}
                                        </span>
                                        <span className="break-words text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                            {formatPreviewPortMappingsSummary(session)}
                                        </span>
                                    </div>
                                    {!canOpen && (
                                        <div className="pl-1 text-[10px] text-slate-500 dark:text-slate-400">
                                            Preview link unavailable until a host port is routed.
                                        </div>
                                    )}
                                    </>
                                );

                                if (!canOpen) {
                                    return (
                                        <div
                                            key={session.id}
                                            role="menuitem"
                                            aria-disabled="true"
                                            aria-label={`Preview link unavailable for ${sprintName}`}
                                            tabIndex={-1}
                                            className={menuItemClassName}
                                            style={{ transition: menuTransition }}
                                        >
                                            {content}
                                        </div>
                                    );
                                }

                                return (
                                    <a
                                        key={session.id}
                                        href={getSafeUrl(buildPreviewUrl(session.id, session.lastKnownPath))}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        role="menuitem"
                                        aria-label={`Open preview session ${sprintName} in a new tab`}
                                        tabIndex={index === firstEnabledIndex ? 0 : -1}
                                        className={menuItemClassName}
                                        style={{ transition: menuTransition }}
                                    >
                                        {content}
                                    </a>
                                );
                            })
                        ) : !selectedProject ? (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-void-700 flex items-center justify-center text-slate-400">
                                    <FolderArchive className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No project selected</p>
                                    <p className="text-xs text-slate-500 mt-1">Select a project to view its active sessions</p>
                                </div>
                            </div>
                        ) : loadError ? (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3" role="alert" aria-live="assertive">
                                <div className="w-10 h-10 rounded-full bg-status-red/10 flex items-center justify-center text-status-red">
                                    <AlertCircle className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-status-red">Could not load sessions</p>
                                    <p className="text-xs text-slate-500 mt-1">{loadError}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-void-700 flex items-center justify-center text-slate-400">
                                    <ServerOff className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No active sessions</p>
                                    <p className="text-xs text-slate-500 mt-1">Launch a session from the browser or sprint page</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
