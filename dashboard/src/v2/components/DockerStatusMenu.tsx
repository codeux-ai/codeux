/**
 * Manual Verification Checklist:
 * - Tab to the Docker status button; press Enter → menu opens, focus moves inside.
 * - Press Escape → menu closes, focus returns to trigger.
 * - Arrow-key through container items.
 * - Hover still opens/closes as before.
 */

import { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Box, Play, Square, Terminal } from "lucide-preact";
import { useFocusTrap } from "../hooks/use-focus-trap";

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  runningFor: string;
  labels: Record<string, string>;
}

export const DockerStatusMenu: FunctionComponent = () => {
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(false);
    const [interactionState, setInteractionState] = useState<'closed' | 'hover' | 'open'>('closed');
    const menuRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<number | null>(null);

    const trapRef = useFocusTrap(interactionState === 'open', { onClose: () => setInteractionState('closed'), restoreFocus: true });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node) &&
                trapRef.current &&
                !trapRef.current.contains(event.target as Node)
            ) {
                setInteractionState('closed');
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setInteractionState('closed');
            }
        };

        if (interactionState === 'open') {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleEscape);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [interactionState, trapRef]);

    const fetchContainers = async () => {
        try {
            setLoading(true);
            const response = await fetch("/api/docker/containers");
            if (!response.ok) {
                throw new Error("Failed to fetch containers");
            }
            const data = await response.json() as DockerContainer[];
            setContainers(data);
        } catch (error) {
            console.error("Error fetching docker containers:", error);
            setContainers([]);
        } finally {
            setLoading(false);
        }
    };

    const handleMouseEnter = () => {
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setInteractionState(prev => {
            if (prev === 'closed') {
                void fetchContainers();
                return 'hover';
            }
            return prev; // if open, stay open
        });
    };

    const handleMouseLeave = () => {
        timeoutRef.current = window.setTimeout(() => {
            setInteractionState(prev => prev === 'hover' ? 'closed' : prev);
        }, 150);
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const activeContainers = containers.filter(c => c.state === "running");

    return (
        <div
            className="relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            ref={menuRef}
        >
            <button
                type="button"
                aria-label="Docker Status"
                aria-haspopup="dialog"
                aria-expanded={interactionState !== 'closed'}
                aria-controls="docker-status-menu"
                onClick={() => {
                    setInteractionState(prev => {
                        if (prev === 'open') return 'closed';
                        if (prev === 'closed' || prev === 'hover') void fetchContainers();
                        return 'open';
                    });
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setInteractionState(prev => {
                            if (prev === 'open') return 'closed';
                            void fetchContainers();
                            return 'open';
                        });
                    } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (interactionState !== 'open') {
                            void fetchContainers();
                            setInteractionState('open');
                        }
                    }
                }}
                className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${
                    interactionState !== 'closed'
                        ? "bg-black/[0.05] dark:bg-white/[0.05]"
                        : "hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                }`}
            >
                <div className="relative">
                    <Box aria-hidden="true" className={`w-4 h-4 transition-colors ${
                        activeContainers.length > 0
                            ? "text-signal-500 dark:text-signal-400"
                            : "text-slate-500 dark:text-slate-400"
                        } group-hover:text-slate-900 dark:group-hover:text-white`} strokeWidth={1.5} />
                    {activeContainers.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.8)] ring-1 ring-[#F9F8F4] dark:ring-void-900" />
                    )}
                </div>
            </button>

            {(interactionState !== 'closed') && (
                <div
                    ref={trapRef}
                    id="docker-status-menu"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Active Docker Containers"
                    className="absolute right-0 top-full mt-2 w-80 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50 flex flex-col"
                >
                    <div className="px-4 py-3 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between shrink-0">
                        <span className="text-xs font-bold uppercase tracking-[0.1em] text-slate-800 dark:text-slate-200">
                            Docker Containers
                        </span>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/[0.03] dark:bg-white/[0.03]">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                            <span className="text-[10px] font-mono font-medium text-slate-500 dark:text-slate-400">
                                {activeContainers.length} Active
                            </span>
                        </div>
                    </div>

                    <div className="max-h-[320px] overflow-y-auto overscroll-contain">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <span className="text-xs font-medium text-slate-400">Loading containers...</span>
                            </div>
                        ) : containers.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                                <Box className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" strokeWidth={1.5} />
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">No Containers</span>
                                <span className="text-xs text-slate-400 mt-1">Docker is not running any containers.</span>
                            </div>
                        ) : (
                            <div className="flex flex-col p-1.5 gap-1.5">
                                {containers.map(container => {
                                    const commandLabel = container.labels?.["sprint-os.command"];

                                    return (
                                        <button
                                            type="button"
                                            key={container.id}
                                            className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex flex-col p-3 rounded-xl hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border border-transparent hover:border-black/[0.04] dark:hover:border-white/[0.04] transition-all"
                                            onKeyDown={(e) => {
                                                if (e.key === "ArrowDown") {
                                                    e.preventDefault();
                                                    const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement;
                                                    if (next) next.focus();
                                                } else if (e.key === "ArrowUp") {
                                                    e.preventDefault();
                                                    const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement;
                                                    if (prev) prev.focus();
                                                }
                                            }}
                                        >
                                            <div className="flex items-start justify-between mb-1.5">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {container.state === "running" ? (
                                                        <Play className="w-3.5 h-3.5 text-signal-500 shrink-0" strokeWidth={2.5} />
                                                    ) : (
                                                        <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={2.5} />
                                                    )}
                                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate" title={container.names}>
                                                        {container.names}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] font-medium text-slate-400 shrink-0 tabular-nums">
                                                    {container.runningFor}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5 mb-2">
                                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate" title={container.image}>
                                                    {container.image}
                                                </span>
                                            </div>

                                            {commandLabel && (
                                                <div className="flex items-start gap-1.5 px-2 py-1.5 bg-black/[0.03] dark:bg-white/[0.03] rounded-lg">
                                                    <Terminal className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                                                    <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300 break-all line-clamp-2">
                                                        {commandLabel}
                                                    </span>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
