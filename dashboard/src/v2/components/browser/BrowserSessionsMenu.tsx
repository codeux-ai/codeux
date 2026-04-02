import type { FunctionComponent } from "preact";
import { useEffect, useState, useRef, useCallback } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { Compass, ExternalLink } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { fetchPreviewSessions } from "../../lib/browser-api.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";
import type { SprintPreviewSession } from "../../../types.js";

export const BrowserSessionsMenu: FunctionComponent<{ enabled?: boolean }> = ({ enabled = true }) => {
    const { selectedProject } = useProjectData();
    const [sessions, setSessions] = useState<SprintPreviewSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (isOpen) {
            void loadSessions();
        }
    }, [isOpen, loadSessions]);

    const handleMouseEnter = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setIsOpen(true);
    };

    const handleMouseLeave = () => {
        hoverTimeout.current = setTimeout(() => {
            setIsOpen(false);
        }, 150);
    };

    const handleFocus = () => {
        setIsOpen(true);
    };

    const handleBlur = (e: FocusEvent) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setIsOpen(false);
        }
    };

    const formatPort = (session: SprintPreviewSession) => {
        if (session.containerAppPort && session.hostPort) {
            return `:${session.hostPort} ➔ ${session.containerAppPort}`;
        }
        return session.containerAppPort ? `:${session.containerAppPort}` : "";
    };

    const statusColors: Record<SprintPreviewSession["status"], string> = {
        starting: "bg-sky-500",
        running: "bg-signal-500",
        stopped: "bg-slate-500",
        error: "bg-ember-500",
    };

    if (!enabled) {
        return null;
    }

    return (
        <div
            className="relative hidden md:inline-block"
            ref={containerRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onFocus={handleFocus}
            onBlur={handleBlur}
        >
            <Link
                to="/browser"
                aria-label="Sprint browser"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.03] px-3.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:border-sky-500/30 hover:bg-sky-500/8 hover:text-sky-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-sky-400/30 dark:hover:bg-sky-400/10 dark:hover:text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
            >
                <Compass aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Browser
            </Link>

            {isOpen && (
                <div
                    role="menu"
                    aria-label="Active Browser Sessions"
                    className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50"
                >
                    <div className="px-3 pt-3 pb-1.5 flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active Sessions</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto pb-1">
                        {loading ? (
                            <div className="px-4 py-4 text-center">
                                <p className="text-xs text-slate-400 font-medium">Loading sessions...</p>
                            </div>
                        ) : sessions.length > 0 ? (
                            sessions.map((session) => (
                                <a
                                    key={session.id}
                                    href={buildPreviewUrl(session.id, session.lastKnownPath)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    role="menuitem"
                                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] group"
                                >
                                    <div className="flex items-center justify-between min-w-0 w-full gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[session.status] || "bg-slate-400"}`} />
                                            <span className="text-sm font-bold truncate text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                {session.sprintName || "Unknown Sprint"}
                                            </span>
                                        </div>
                                        <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-sky-500 transition-colors" />
                                    </div>
                                    <div className="flex items-center pl-4">
                                        <span className="text-[10px] font-mono text-slate-400 truncate">
                                            {formatPort(session)} {session.status !== 'running' ? `(${session.status})` : ''}
                                        </span>
                                    </div>
                                </a>
                            ))
                        ) : (
                            <div className="px-4 py-4 text-center">
                                <p className="text-xs text-slate-400 font-medium">
                                    {!selectedProject ? "Select a project to view sessions." : "No active browser sessions."}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
