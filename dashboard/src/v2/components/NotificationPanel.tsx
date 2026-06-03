import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import gsap from "gsap";
import { CheckCheck, RefreshCw, X } from "lucide-preact";
import { useOverviewTelemetry } from "../../hooks/use-overview-telemetry.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import type { DashboardNotification } from "../hooks/use-notifications.js";
import {
  buildInterventionNotifications,
  type InterventionNotificationViewModel,
} from "../lib/overview-telemetry-view-models.js";

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
    icon: "text-sky-600 dark:text-sky-300",
    badge: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    accent: "bg-sky-500",
  },
};

const interventionClasses = {
  icon: "text-status-amber",
  badge: "border-status-amber/25 bg-status-amber/10 text-status-amber",
  accent: "bg-status-amber",
};

type NotificationRowData = DashboardNotification | InterventionNotificationViewModel;

const NotificationRow: FunctionComponent<{
  id: string;
  icon: DashboardNotification["icon"];
  iconClass: string;
  badgeClass: string;
  accentClass: string;
  title: string;
  subtitle: string;
  trailingLabel: string;
  unread: boolean;
  interactive?: boolean;
  onMarkRead?: (id: string) => void;
  onDismiss?: (id: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  dismissible?: boolean;
}> = ({
  id,
  icon,
  iconClass,
  badgeClass,
  accentClass,
  title,
  subtitle,
  trailingLabel,
  unread,
  interactive = true,
  onMarkRead,
  onDismiss,
  actionLabel,
  onAction,
  dismissible = false,
}) => {
  const Icon = icon;

  return (
    <div
      data-notification-item
      role={interactive ? "menuitem" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onFocus={interactive ? () => onMarkRead?.(id) : undefined}
      className="group relative mb-2 rounded-2xl border border-black/[0.05] bg-white/75 p-3 text-left transition-colors hover:border-black/[0.1] hover:bg-black/[0.025] last:mb-0 dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.06]"
    >
      {unread ? (
        <div className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full ${accentClass}`} />
      ) : null}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${badgeClass}`}>
          <Icon className={`h-4 w-4 ${iconClass}`} strokeWidth={2.3} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</div>
            </div>
            <div className="shrink-0 text-[10px] font-medium text-slate-400">{trailingLabel}</div>
          </div>
          {interactive ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onMarkRead?.(id)}
                className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:bg-black/[0.04] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
              >
                {unread ? "Mark read" : "Read"}
              </button>
              <div className="flex items-center gap-1.5">
                {actionLabel && onAction ? (
                  <button
                    type="button"
                    onClick={() => {
                      onMarkRead?.(id);
                      onAction();
                    }}
                    className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 hover:bg-signal-500/15 dark:text-signal-300"
                  >
                    {actionLabel}
                  </button>
                ) : null}
                {dismissible ? (
                  <button
                    type="button"
                    onClick={() => onDismiss?.(id)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-black/[0.05] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                    aria-label={`Dismiss ${title}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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
  const { telemetry, refresh: refreshTelemetry } = useOverviewTelemetry();

  const interventionNotifications = useMemo(() => buildInterventionNotifications(telemetry), [telemetry]);
  const visibleNotifications = useMemo<NotificationRowData[]>(
    () => [...interventionNotifications, ...notifications],
    [interventionNotifications, notifications],
  );

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
          duration: prefersReducedMotion ? 0 : 0.25,
          ease: "power2.out",
        },
      );
      gsap.fromTo(
        panelRef.current?.querySelectorAll("[data-notification-item]") || [],
        { opacity: 0, x: 10 },
        { opacity: 1, x: 0, duration: prefersReducedMotion ? 0 : 0.22, stagger: 0.035, ease: "power2.out" },
      );
    });

    return () => ctx.revert();
  }, [prefersReducedMotion, visibleNotifications.length]);

  const handleRefresh = (): void => {
    onRefresh();
    void refreshTelemetry();
  };

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Notifications Panel"
      className="absolute right-0 top-full mt-2 w-[23rem] overflow-hidden rounded-2xl border border-black/[0.06] bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/95 dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] z-50 flex flex-col"
    >
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
            onClick={handleRefresh}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label="Refresh notifications"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label="Mark all notifications read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="dashboard-scrollbar max-h-96 overflow-y-auto p-2">
        {visibleNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
            <div className="rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
              Clear
            </div>
            <div className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">No notifications</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Startup checks are healthy and there is nothing waiting for operator attention.
            </div>
          </div>
        ) : visibleNotifications.map((notification) => {
          if ("projectName" in notification) {
            return (
              <NotificationRow
                key={notification.id}
                id={notification.id}
                icon={notification.icon}
                iconClass={interventionClasses.icon}
                badgeClass={interventionClasses.badge}
                accentClass={interventionClasses.accent}
                title={notification.title}
                subtitle={notification.subtitle}
                trailingLabel={notification.projectName}
                unread={notification.unread}
                interactive={false}
              />
            );
          }

          const classes = severityClasses[notification.severity];

          return (
            <NotificationRow
              key={notification.id}
              id={notification.id}
              icon={notification.icon}
              iconClass={classes.icon}
              badgeClass={classes.badge}
              accentClass={classes.accent}
              title={notification.title}
              subtitle={notification.body}
              trailingLabel={notification.time}
              unread={notification.unread}
              onMarkRead={onMarkRead}
              onDismiss={onDismiss}
              actionLabel={notification.actionLabel}
              onAction={notification.onAction}
              dismissible={notification.dismissible}
            />
          );
        })}
      </div>
    </div>
  );
};
