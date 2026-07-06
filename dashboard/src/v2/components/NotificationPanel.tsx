import type { FunctionComponent } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useGsapInteractionTokens } from "../lib/motion/constants.js";
import { CheckCheck, RefreshCw, X } from "lucide-preact";
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
  onMarkAllRead: () => void | Promise<void>;
  onMarkRead: (id: string) => void | Promise<void>;
  onDismiss: (id: string) => void;
  onRefresh: () => void | Promise<void>;
}> = ({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  onDismiss,
  onRefresh,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hasMountedListRef = useRef(false);
  const previousNotificationIdsRef = useRef<string>("");
  const motionTokens = useGsapInteractionTokens();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [pendingReadIds, setPendingReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  const visibleNotifications = useMemo(() => {
    return [...notifications].sort((left, right) => {
      if (left.severity === right.severity) {
        return 0;
      }
      if (left.severity === "critical") {
        return -1;
      }
      if (right.severity === "critical") {
        return 1;
      }
      return 0;
    });
  }, [notifications]);

  const notificationIds = useMemo(
    () => visibleNotifications.map((notification) => notification.id).join("|"),
    [visibleNotifications],
  );

  const focusPanel = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      panel.focus();
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const focusPanelAfterUpdate = useCallback(() => {
    queueMicrotask(focusPanel);
  }, [focusPanel]);

  const focusPanelIfTargetRemoved = useCallback((target: HTMLElement | null) => {
    queueMicrotask(() => {
      if (target && !target.isConnected) {
        focusPanel();
      }
    });
  }, [focusPanel]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    setAnnouncement("Refreshing notifications.");
    try {
      await onRefresh();
      setAnnouncement("Notifications refreshed.");
    } catch {
      setAnnouncement("Notifications could not be refreshed.");
    } finally {
      setIsRefreshing(false);
      focusPanelAfterUpdate();
    }
  }, [focusPanelAfterUpdate, isRefreshing, onRefresh]);

  const handleMarkAllRead = useCallback(async (): Promise<void> => {
    if (isMarkingAllRead || unreadCount === 0) {
      return;
    }

    setIsMarkingAllRead(true);
    setAnnouncement(`Marking ${unreadCount} notification${unreadCount === 1 ? "" : "s"} read.`);
    try {
      await onMarkAllRead();
      setAnnouncement("All notifications marked read.");
    } finally {
      setIsMarkingAllRead(false);
      focusPanelAfterUpdate();
    }
  }, [focusPanelAfterUpdate, isMarkingAllRead, onMarkAllRead, unreadCount]);

  const handleMarkRead = useCallback(async (notification: DashboardNotification, focusTarget?: HTMLElement | null): Promise<void> => {
    if (!notification.unread || pendingReadIdsRef.current.has(notification.id)) {
      return;
    }

    const target = focusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let markedRead = false;
    pendingReadIdsRef.current.add(notification.id);
    setPendingReadIds((previous) => new Set(previous).add(notification.id));
    setAnnouncement(`Marking ${notification.title} read.`);
    try {
      await onMarkRead(notification.id);
      markedRead = true;
      setAnnouncement(`${notification.title} marked read.`);
    } finally {
      pendingReadIdsRef.current.delete(notification.id);
      setPendingReadIds((previous) => {
        const next = new Set(previous);
        next.delete(notification.id);
        return next;
      });
      if (markedRead) {
        focusPanelIfTargetRemoved(target);
      }
    }
  }, [focusPanelIfTargetRemoved, onMarkRead]);

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
          duration: motionTokens.enterExit.duration,
          ease: motionTokens.enterExit.ease,
        },
      );
    });

    return () => ctx.revert();
  }, [motionTokens.enterExit.duration, motionTokens.enterExit.ease]);

  useLayoutEffect(() => {
    if (!listRef.current) return;

    const items = listRef.current.querySelectorAll("[data-notification-item]");
    if (items.length === 0) {
      previousNotificationIdsRef.current = notificationIds;
      hasMountedListRef.current = true;
      return;
    }

    const contract = hasMountedListRef.current ? motionTokens.listReorder : motionTokens.listReveal;
    const previousIds = previousNotificationIdsRef.current;
    previousNotificationIdsRef.current = notificationIds;
    hasMountedListRef.current = true;

    if (contract.duration === 0 || previousIds === notificationIds) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        hasMountedListRef.current && previousIds ? { opacity: 0.84, y: -4 } : { opacity: 0, x: 10 },
        {
          opacity: 1,
          x: 0,
          y: 0,
          duration: contract.duration,
          stagger: contract.duration / 5,
          ease: contract.ease,
          overwrite: "auto",
        },
      );
    }, listRef);

    return () => ctx.revert();
  }, [motionTokens.listReveal.duration, motionTokens.listReveal.ease, motionTokens.listReorder.duration, motionTokens.listReorder.ease, notificationIds]);

  const busy = isRefreshing || isMarkingAllRead;
  const markAllReadDisabledReason = isMarkingAllRead
    ? "Marking all notifications read"
    : unreadCount === 0
      ? "All notifications are already read"
      : "";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications Panel"
      aria-busy={busy ? "true" : "false"}
      tabIndex={-1}
      className="fixed inset-x-4 top-[72px] sm:inset-auto sm:absolute sm:top-full sm:right-0 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/95 shadow-2xl backdrop-blur-2xl dark:bg-void-800/95 z-50 flex flex-col"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}. Notifications are current after the latest refresh request.
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-signal-500/40 to-transparent" />

      <div className="flex items-center justify-between gap-2 shrink-0 border-b border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Notifications
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isRefreshing ? "Refreshing notifications" : isMarkingAllRead ? "Marking notifications read" : unreadCount === 0 ? "All notifications are read" : "Startup checks and operator attention"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors motion-reduce:transition-none hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label={isRefreshing ? "Refreshing notifications" : "Refresh notifications"}
            aria-disabled={isRefreshing ? "true" : "false"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={unreadCount === 0 || isMarkingAllRead}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors motion-reduce:transition-none hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
            aria-label={markAllReadDisabledReason || "Mark all notifications read"}
            aria-describedby={markAllReadDisabledReason ? "notification-mark-all-read-reason" : undefined}
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {markAllReadDisabledReason ? (
        <div id="notification-mark-all-read-reason" className="border-b border-black/[0.06] px-4 py-2 text-[11px] font-medium text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
          {markAllReadDisabledReason}
        </div>
      ) : null}

      <ul ref={listRef} className="dashboard-scrollbar flex-1 min-h-0 overflow-y-auto p-2 m-0 list-none" aria-live="polite" aria-label="Notifications list" aria-busy={busy ? "true" : "false"}>
        {visibleNotifications.length === 0 ? (
          <li role="status" className="flex flex-col items-center justify-center px-5 py-10 text-center">
            <div className="rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
              Clear
            </div>
            <div className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">No notifications</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Startup checks are healthy and there is nothing waiting for operator attention.
            </div>
          </li>
        ) : visibleNotifications.map((notification) => {
          const classes = severityClasses[notification.severity];
          const Icon = notification.icon;
          const details = notification.body ?? notification.subtitle;
          const accentClass = notification.type === "intervention" ? "bg-signal-500" : classes.accent;
          const iconClass = notification.iconColor ?? classes.icon;
          const isMarkingRead = pendingReadIds.has(notification.id);
          const itemBusy = isMarkingRead || busy;

          return (
            <li
              key={notification.id}
              data-notification-item
              data-motion-contract="listReorder"
              tabIndex={0}
              onFocus={(event) => {
                void handleMarkRead(notification, event.currentTarget);
              }}
              aria-busy={itemBusy ? "true" : "false"}
              className="group relative mb-2 rounded-2xl border border-black/[0.05] bg-white/75 p-3 text-left transition-colors motion-reduce:transition-none hover:border-black/[0.1] hover:bg-black/[0.025] last:mb-0 dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.06]"
            >
              {notification.unread ? (
                <div className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full ${accentClass}`} />
              ) : null}
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${classes.badge}`}>
                  <Icon className={`h-4 w-4 ${iconClass}`} strokeWidth={2.3} aria-hidden="true" />
                  <span className="sr-only">Notification severity: {notification.severity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-bold text-slate-800 dark:text-slate-100">{notification.title}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        <span aria-label={notification.unread ? "Unread notification" : "Read notification"}>
                          {notification.unread ? "Unread" : "Read"}
                        </span>
                      </div>
                      {details ? (
                        <div className="mt-1 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">{details}</div>
                      ) : null}
                      {isMarkingRead ? (
                        <div className="mt-2 rounded-lg border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
                          Marking read
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-[10px] font-medium text-slate-400">{notification.time}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        void handleMarkRead(notification, event.currentTarget);
                      }}
                      disabled={isMarkingRead || !notification.unread}
                      className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:bg-black/[0.04] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-55 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                      aria-label={`${isMarkingRead ? "Marking read" : notification.unread ? "Mark read" : "Read"} ${notification.title}`}
                    >
                      {isMarkingRead ? "Marking read" : notification.unread ? "Mark read" : "Read"}
                    </button>
                    <div className="flex items-center gap-1.5">
                      {notification.actionLabel && notification.onAction ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (document.activeElement === e.currentTarget) {
                              focusPanel();
                              (e.currentTarget as HTMLElement).blur();
                            }
                            void handleMarkRead(notification);
                            notification.onAction?.();
                            setAnnouncement(`${notification.actionLabel} opened for ${notification.title}.`);
                            focusPanelAfterUpdate();
                          }}
                          className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 hover:bg-black/10 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white transition-colors motion-reduce:transition-none"
                          aria-label={`${notification.actionLabel} ${notification.title}`}
                        >
                          {notification.actionLabel}
                        </button>
                      ) : null}
                      {notification.dismissible ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (document.activeElement === e.currentTarget) {
                              focusPanel();
                              (e.currentTarget as HTMLElement).blur();
                            }
                            onDismiss(notification.id);
                            setAnnouncement(`${notification.title} dismissed.`);
                            focusPanelAfterUpdate();
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
