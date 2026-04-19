import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { CheckCircle, AlertTriangle, GitPullRequest } from "lucide-preact";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

export const NotificationPanel: FunctionComponent = () => {
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
            className="absolute right-0 top-full mt-3 w-80 bg-white/98 dark:bg-void-900/98 backdrop-blur-3xl border border-black/[0.04] dark:border-white/[0.06] rounded-[2rem] shadow-[0_32px_64px_rgba(0,0,0,0.16)] dark:shadow-[0_32px_64px_rgba(0,0,0,0.6)] overflow-hidden z-50 flex flex-col"
        >
            {/* Top decorative jade gradient border */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-signal-500/30 to-transparent" />

            <div className="px-5 py-4 flex justify-between items-center border-b border-black/[0.04] dark:border-white/[0.04] bg-void-50/30 dark:bg-white/[0.01]">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-void-500">
                    Notifications
                </span>
                <button
                    type="button"
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-void-500 hover:text-signal-500 dark:hover:text-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-md px-1.5 transition-all active:scale-95"
                >
                    Mark all read
                </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto pb-1 flex flex-col">
                {notifications.map((notification) => (
                    <div
                        key={notification.id}
                        role="menuitem"
                        className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-start gap-4 px-5 py-4 text-left transition-all hover:bg-signal-500/[0.03] group border-b border-black/[0.03] dark:border-white/[0.03] last:border-0 cursor-pointer active:scale-[0.98]"
                    >
                        {/* Unread indicator accent bar */}
                        {notification.unread && (
                            <div className="absolute left-0 top-3 bottom-3 w-[2.5px] bg-signal-500 rounded-full" />
                        )}

                        <div className="shrink-0 mt-0.5">
                            <notification.icon className={`w-4 h-4 ${notification.iconColor} opacity-80 group-hover:opacity-100 transition-opacity`} strokeWidth={2.5} />
                        </div>

                        <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[13px] font-bold text-slate-700 dark:text-void-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors truncate tracking-tight">
                                    {notification.title}
                                </span>
                                <span className="text-[10px] font-bold font-mono text-slate-400 dark:text-void-500 shrink-0">
                                    {notification.time}
                                </span>
                            </div>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-void-500/60 line-clamp-2 leading-relaxed tracking-normal group-hover:text-slate-600 dark:group-hover:text-void-400 transition-colors">
                                {notification.subtitle}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-5 py-4 border-t border-black/[0.04] dark:border-white/[0.04] bg-void-50/30 dark:bg-white/[0.01] text-center">
                <button
                    type="button"
                    className="w-full text-[10px] font-black uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400 hover:text-signal-700 dark:hover:text-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-xl px-4 py-2 transition-all active:scale-95 bg-signal-500/[0.05] hover:bg-signal-500/[0.08]"
                >
                    View all notifications
                </button>
            </div>
        </div>
    );
};
