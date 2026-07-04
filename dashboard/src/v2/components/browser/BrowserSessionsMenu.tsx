import type { FunctionComponent } from "preact";
import { useEffect, useState, useRef, useCallback } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { Compass, ExternalLink, Loader2, ServerOff, FolderArchive, Play, Square, AlertCircle } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { fetchPreviewSessions } from "../../lib/browser-api.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";
import type { SprintPreviewSession } from "../../../types.js";
import { getSafeUrl } from "../../lib/safe-url.js";

type InteractionState = 'closed' | 'hover' | 'open';

export const BrowserSessionsMenu: FunctionComponent<{ enabled?: boolean }> = ({ enabled = true }) => {
    const { selectedProject } = useProjectData();
    const [sessions, setSessions] = useState<SprintPreviewSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [interactionState, setInteractionState] = useState<InteractionState>('closed');
    const containerRef = useRef<HTMLDivElement>(null);
    const [menuId] = useState(() => `browser-menu-${Math.random().toString(36).substr(2, 9)}`);
    const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isMenuVisible = interactionState !== 'closed';

    const loadSessions = useCallback(async () => {
        if (!selectedProject?.id) {
            setSessions([]);
            return;
        }
        try {
            setLoading(true);
            const data = await fetchPreviewSessions(selectedProject.id);
            setSessions(data || []);
        } catch (error) {
            console.error("Failed to fetch browser sessions:", error);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    }, [selectedProject?.id]);

    useEffect(() => {
        if (isMenuVisible) {
            void loadSessions();
        }
    }, [isMenuVisible, loadSessions]);

    const handleMouseEnter = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        if (interactionState === 'closed') {
            setInteractionState('hover');
        }
    };

    const handleMouseLeave = () => {
        if (interactionState === 'hover') {
            hoverTimeout.current = setTimeout(() => {
                setInteractionState((prev) => (prev === 'hover' ? 'closed' : prev));
            }, 150);
        }
    };

    const handleFocus = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setInteractionState('open');
    };

    const handleBlur = (e: FocusEvent) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setInteractionState('closed');
        }
    };

    const toggleMenu = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setInteractionState((prev) => (prev === 'closed' || prev === 'hover' ? 'open' : 'closed'));
    };

    const handleMenuKeyDown = (e: KeyboardEvent) => {
        if (!isMenuVisible || !containerRef.current) return;

        const items = Array.from(containerRef.current.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
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
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isMenuVisible) {
                setInteractionState('closed');
                const triggerBtn = containerRef.current?.querySelector('button');
                triggerBtn?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isMenuVisible]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isMenuVisible && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setInteractionState('closed');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMenuVisible]);

    const formatPort = (session: SprintPreviewSession) => {
        if (session.containerAppPort && session.hostPort) {
            return `:${session.containerAppPort} ➔ :${session.hostPort}`;
        }
        return session.containerAppPort ? `:${session.containerAppPort} ➔ pending` : "port pending";
    };

    const statusTone: Record<SprintPreviewSession["status"], string> = {
        starting: "border-ember-500/25 bg-ember-500/10 text-ember-600 dark:text-ember-400",
        running: "border-signal-500/25 bg-signal-500/10 text-signal-600 dark:text-signal-400",
        stopped: "border-slate-400/25 bg-slate-500/10 text-slate-600 dark:border-slate-500/35 dark:text-slate-300",
        error: "border-status-red/25 bg-status-red/10 text-status-red",
    };

    if (!enabled) {
        return null;
    }

    return (
        <div
            className="relative hidden md:block"
            ref={containerRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onKeyDown={handleMenuKeyDown as any}
        >
            <button
                type="button"
                data-tour-id="active-sessions"
                onClick={toggleMenu}
                onFocus={handleFocus}
                onBlur={handleBlur}
                aria-haspopup="menu"
                aria-expanded={isMenuVisible}
                aria-controls={isMenuVisible ? menuId : undefined}
                aria-label={`Browser Sessions: ${sessions.length} active`}
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    isMenuVisible
                    ? "bg-signal-500/10 text-signal-600 dark:bg-signal-400/10 dark:text-signal-300"
                    : "hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                }`}
            >
                <Compass aria-hidden="true" className={"w-4 h-4 transition-colors " + (isMenuVisible ? "text-signal-600 dark:text-signal-300" : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white")} strokeWidth={1.5} />
                {sessions.length > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.5)]" aria-hidden="true" />
                )}
            </button>

            {isMenuVisible && (
                <div
                    role="menu"
                    id={menuId}
                    aria-label="Active Browser Sessions"
                    className="fixed inset-x-4 top-[72px] z-50 mt-2 flex max-h-[calc(100dvh-5rem)] w-auto max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/95 dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] md:inset-auto md:absolute md:right-0 md:top-full md:w-80"
                >
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.02] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active Sessions</span>
                        <Link
                            to="/browser"
                            onClick={() => setInteractionState('closed')}
                            className="rounded-md px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 hover:text-signal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-signal-500 dark:hover:text-signal-400"
                        >
                            Open App
                        </Link>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1" onKeyDown={handleMenuKeyDown as any}>
                        {loading ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center" aria-busy={loading}>
                                <Loader2 className="h-5 w-5 animate-spin text-signal-500" />
                                <p className="text-xs font-medium text-slate-500">Discovering active sessions...</p>
                            </div>
                        ) : sessions.length > 0 ? (
                            sessions.map((session, index) => (
                                <a
                                    key={session.id}
                                    href={getSafeUrl(buildPreviewUrl(session.id, session.lastKnownPath))}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    role="menuitem"
                                    tabIndex={index === 0 ? 0 : -1}
                                    className="group flex w-full min-w-0 flex-col gap-2 border-b border-black/[0.04] px-3 py-3 text-left transition-colors last:border-0 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.04] dark:hover:bg-white/[0.04]"
                                >
                                    <div className="flex min-w-0 items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-col gap-1.5">
                                            <div className={`flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 ${statusTone[session.status]}`}>
                                                {session.status === 'starting' ? <Loader2 className="h-3 w-3 animate-spin" /> : session.status === 'running' ? <Play className="h-3 w-3" fill="currentColor" /> : session.status === 'error' ? <AlertCircle className="h-3 w-3" /> : <Square className="h-3 w-3" fill="currentColor" />}
                                                <span className="text-[9px] font-bold uppercase tracking-[0.1em]">{session.status}</span>
                                            </div>
                                            <span className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-700 transition-colors line-clamp-2 group-hover:text-slate-900 dark:text-slate-200 dark:group-hover:text-white">
                                                {session.sprintName || "Unknown Sprint"}
                                            </span>
                                        </div>
                                        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-signal-500" />
                                    </div>
                                    <div className="flex min-w-0 items-center pl-1">
                                        <span className="break-all font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                            {formatPort(session)}
                                        </span>
                                    </div>
                                </a>
                            ))
                        ) : !selectedProject ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-void-700">
                                    <FolderArchive className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No project selected</p>
                                    <p className="text-xs text-slate-500 mt-1">Select a project to view its active sessions</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-void-700">
                                    <ServerOff className="h-5 w-5" />
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
