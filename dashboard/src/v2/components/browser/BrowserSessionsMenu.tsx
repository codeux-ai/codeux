import type { FunctionComponent } from "preact";
import { useEffect, useState, useRef, useCallback } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { Compass, ExternalLink, Loader2, ServerOff, FolderArchive } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { fetchPreviewSessions } from "../../lib/browser-api.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";
import type { SprintPreviewSession } from "../../../types.js";

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
                setTimeout(() => triggerBtn?.focus(), 0);
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

    const statusColors: Record<SprintPreviewSession["status"], string> = {
        starting: "bg-signal-500",
        running: "bg-signal-500",
        stopped: "bg-slate-500",
        error: "bg-ember-500",
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
                className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    isMenuVisible
                    ? "bg-signal-500/8 dark:bg-signal-400/10"
                    : "hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                }`}
            >
                <Compass aria-hidden="true" className={"w-4 h-4 transition-colors " + (isMenuVisible ? "text-signal-600 dark:text-signal-300" : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white")} strokeWidth={1.5} />
            </button>

            {isMenuVisible && (
                <div
                    role="menu"
                    id={menuId}
                    aria-label="Active Browser Sessions"
                    className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50 flex flex-col"
                >
                    <div className="px-3 py-2 flex justify-between items-center border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active Sessions</span>
                        <Link
                            to="/browser"
                            onClick={() => setInteractionState('closed')}
                            className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 hover:text-signal-700 dark:text-signal-500 dark:hover:text-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-md px-1"
                        >
                            Open App
                        </Link>
                    </div>
                    <div className="max-h-64 overflow-y-auto pb-1 flex flex-col">
                        {loading ? (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3">
                                <Loader2 className="w-5 h-5 text-signal-500 animate-spin" />
                                <p className="text-xs text-slate-500 font-medium">Discovering active sessions...</p>
                            </div>
                        ) : sessions.length > 0 ? (
                            sessions.map((session) => (
                                <a
                                    key={session.id}
                                    href={buildPreviewUrl(session.id, session.lastKnownPath)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    role="menuitem"
                                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex flex-col gap-1.5 px-3 py-3 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] group border-b border-black/[0.04] dark:border-white/[0.04] last:border-0"
                                >
                                    <div className="flex items-center justify-between min-w-0 w-full gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="flex items-center gap-1.5 shrink-0 bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 rounded-md">
                                                <div className={`w-1.5 h-1.5 rounded-full ${statusColors[session.status] || "bg-slate-400"}`} />
                                                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{session.status}</span>
                                            </div>
                                            <span className="text-sm font-semibold truncate text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                {session.sprintName || "Unknown Sprint"}
                                            </span>
                                        </div>
                                        <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-signal-500 transition-colors" />
                                    </div>
                                    <div className="flex items-center pl-1">
                                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                                            {formatPort(session)}
                                        </span>
                                    </div>
                                </a>
                            ))
                        ) : !selectedProject ? (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-void-700 flex items-center justify-center text-slate-400">
                                    <FolderArchive className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No project selected</p>
                                    <p className="text-xs text-slate-500 mt-1">Select a project to view its active sessions</p>
                                </div>
                            </div>
                        ) : (
                            <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3">
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
