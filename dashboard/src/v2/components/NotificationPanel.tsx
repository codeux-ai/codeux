import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { GSAP_INTERACTION_TOKENS, useGsapDurations } from "../lib/motion/constants.js";
import { CheckCheck, RefreshCw, X } from "lucide-preact";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import type { DashboardNotification } from "../hooks/use-notifications.js";

const severityClasses: Record<DashboardNotification["severity"], {
  icon: string;
  badge: string;
  accent: string;
}> = {
  critical: {
    icon: "text-status-red",
    badge: "border-status-red/25 bg-status-red/10 text-status-red",
    accent: "bg-status-red",
  },
  warning: {
    icon: "text-status-amber",
    badge: "border-status-amber/25 bg-status-amber/10 text-status-amber",
    accent: "bg-status-amber",
  },
  success: {
    icon: "text-signal-600 dark:text-signal-300",
    badge: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-300",
    accent: "bg-signal-500",
  },
  info: {
    icon: "text-signal-600 dark:text-signal-300",
    badge: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-300",
    accent: "bg-signal-500",
  },
};

export const NotificationPanel: FunctionComponent<{
  notifications: DashboardNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onRefresh: () => void;
}> = ({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  onDismiss,
  onRefresh,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const durations = useGsapDurations();

  useLayoutEffect(() => {
    if (!panelRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        panelRef.current,
        { y: -8, opacity: 0, scale: 0.985 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: durations.base,
          ease: GSAP_INTERACTION_TOKENS.enterExit.ease,
        },
      );
      gsap.fromTo(
        panelRef.current?.querySelectorAll("[data-notification-item]") || [],
        { opacity: 0, x: 10 },
        { opacity: 1, x: 0, duration: durations.base, stagger: 0.035, ease: GSAP_INTERACTION_TOKENS.enterExit.ease },
      );
    });

    return () => ctx.revert();
  }, [durations, notifications.length]);

  return (
    <div
      ref={panelRef}
      aria-label="Notifications Panel"
        className="absolute right-0 top-full mt-2 w-[23rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/95 shadow-2xl backdrop-blur-2xl dark:bg-void-800/95 z-50 flex flex-col"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
      </div>

      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-signal-500/40 to-transparent" />

      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Notifications
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Startup checks and operator attention
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label="Refresh notifications"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label="Mark all notifications read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ul className="dashboard-scrollbar max-h-96 overflow-y-auto p-2 m-0 list-none">
        {notifications.length === 0 ? (
          <li className="flex flex-col items-center justify-center px-5 py-10 text-center">
            <div className="rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
              Clear
            </div>
            <div className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">No notifications</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Startup checks are healthy and there is nothing waiting for operator attention.
            </div>
          </li>
        ) : notifications.map((notification) => {
          const classes = severityClasses[notification.severity];
          const Icon = notification.icon;
          const details = notification.body ?? notification.subtitle;
          const accentClass = notification.type === "intervention" ? "bg-signal-500" : classes.accent;
          const iconClass = notification.iconColor ?? classes.icon;

          return (
            <li
              key={notification.id}
              data-notification-item
              tabIndex={0}
              onFocus={() => onMarkRead(notification.id)}
              className="group relative mb-2 rounded-2xl border border-black/[0.05] bg-white/75 p-3 text-left transition-colors hover:border-black/[0.1] hover:bg-black/[0.025] last:mb-0 dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.06]"
            >
              {notification.unread ? (
                <div className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full ${accentClass}`} />
              ) : null}
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${classes.badge}`}>
                  <Icon className={`h-4 w-4 ${iconClass}`} strokeWidth={2.3} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{notification.title}</div>
                      {details ? (
                        <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{details}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-[10px] font-medium text-slate-400">{notification.time}</div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onMarkRead(notification.id)}
                      className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:bg-black/[0.04] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                    >
                      {notification.unread ? "Mark read" : "Read"}
                    </button>
                    <div className="flex items-center gap-1.5">
                      {notification.actionLabel && notification.onAction ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (document.activeElement === e.currentTarget) {
                              const fallback = document.querySelector('[role="main"]') || document.body;
                              (fallback as HTMLElement).focus();
                              (e.currentTarget as HTMLElement).blur();
                            }
                            onMarkRead(notification.id);
                            notification.onAction?.();
                          }}
                          className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 hover:bg-black/10 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white transition-colors"
                        >
                          {notification.actionLabel}
                        </button>
                      ) : null}
                      {notification.dismissible ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (document.activeElement === e.currentTarget) {
                              const fallback = document.querySelector('[role="main"]') || document.body;
                              (fallback as HTMLElement).focus();
                              (e.currentTarget as HTMLElement).blur();
                            }
                            onDismiss(notification.id);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                          aria-label={`Dismiss ${notification.title}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
