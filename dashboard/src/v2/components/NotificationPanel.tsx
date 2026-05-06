import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { CheckCircle, AlertTriangle, GitPullRequest } from "lucide-preact";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

export const NotificationPanel: FunctionComponent<{ id?: string }> = ({ id }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        if (!panelRef.current) return;

        const ctx = gsap.context(() => {
            gsap.fromTo(
                panelRef.current,
                { y: -8, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: prefersReducedMotion ? 0 : 0.25,
                    ease: "power2.out"
                }
            );
        });

        return () => ctx.revert();
    }, [prefersReducedMotion]);

    const notifications = [
        {
            id: "1",
            type: "success",
            title: "Deployment successful",
            subtitle: "Production deployment for my-awesome-project completed in 45s.",
            time: "2m ago",
            unread: true,
            icon: CheckCircle,
            iconColor: "text-signal-500",
        },
        {
            id: "2",
            type: "warning",
            title: "High CPU usage detected",
            subtitle: "Workspace api-server is utilizing 95% CPU resources.",
            time: "15m ago",
            unread: true,
            icon: AlertTriangle,
            iconColor: "text-amber-500",
        },
        {
            id: "3",
            type: "pr",
            title: "Pull request merged",
            subtitle: "Jules has merged 'feature/notification-panel' into main.",
            time: "1h ago",
            unread: false,
            icon: GitPullRequest,
            iconColor: "text-sky-500",
        },
    ];

    return (
        <div
            ref={panelRef}
            role="menu"
            aria-label="Notifications Panel"
            className="absolute right-0 top-full mt-2 w-80 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50 flex flex-col"
        >
            {/* Top decorative jade gradient border */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-signal-500/40 to-transparent" />

            <div className="px-4 py-3 flex justify-between items-center border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    Notifications
                </span>
                <button
                    type="button"
                    className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-md px-1 transition-colors"
                >
                    Mark all read
                </button>
            </div>

            <div className="max-h-80 overflow-y-auto pb-1 flex flex-col">
                {notifications.map((notification) => (
                    <div
                        key={notification.id}
                        role="menuitem"
                        className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-signal-500/5 group border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 cursor-pointer"
                    >
                        {/* Unread indicator accent bar */}
                        {notification.unread && (
                            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-signal-500" />
                        )}

                        <div className="shrink-0 mt-0.5">
                            <notification.icon className={`w-4 h-4 ${notification.iconColor}`} strokeWidth={2} />
                        </div>

                        <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors truncate">
                                    {notification.title}
                                </span>
                                <span className="text-[10px] text-slate-400 shrink-0">
                                    {notification.time}
                                </span>
                            </div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-2 leading-relaxed">
                                {notification.subtitle}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-4 py-3 border-t border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] text-center">
                <button
                    type="button"
                    className="text-[10px] font-semibold text-signal-600 dark:text-signal-400 hover:text-signal-700 dark:hover:text-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-md px-2 py-1 transition-colors"
                >
                    View all notifications
                </button>
            </div>
        </div>
    );
};
