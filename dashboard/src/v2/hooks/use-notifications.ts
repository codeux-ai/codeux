import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, CalendarClock, CheckCircle, Info, KeyRound } from "lucide-preact";
import { fetchDashboardNotifications, fetchOnboardingReadiness } from "../../lib/api/dashboard-api.js";
import type { DashboardNotificationFeed, OnboardingRuntimeReadiness } from "../../types.js";
import { openOnboarding } from "../lib/onboarding-control.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { fetchActiveAgentSchedulerEntries, type AgentSchedulerSummaryEntry } from "../lib/scheduler-api.js";
import { isDeepEqual } from "../lib/resource-equality.js";
import { useOptionalDashboardI18n } from "../i18n/context.js";
import { translateDashboardMessage, type DashboardLocale, type DashboardTextMessageKey } from "../i18n/locales.js";
import { shellMessages } from "../i18n/messages/shell.js";
import {
  toNotificationViewModel,
  type NotificationSeverity,
  type NotificationViewModel,
} from "../lib/notification-view-models.js";

const NOTIFICATION_STATE_KEY = "codeux:notification-state:v1";

export type DashboardNotification = NotificationViewModel;
export type { NotificationSeverity };

interface StoredNotificationState {
  readIds: string[];
  dismissedIds: string[];
}

const readStoredState = (): StoredNotificationState => {
  if (typeof window === "undefined") {
    return { readIds: [], dismissedIds: [] };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTIFICATION_STATE_KEY) || "{}") as Partial<StoredNotificationState>;
    return {
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
      dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : [],
    };
  } catch {
    return { readIds: [], dismissedIds: [] };
  }
};

const writeStoredState = (state: StoredNotificationState): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify({
    readIds: Array.from(new Set(state.readIds)),
    dismissedIds: Array.from(new Set(state.dismissedIds)),
  }));
};

const shellText = (
  locale: DashboardLocale,
  key: DashboardTextMessageKey<typeof shellMessages>,
  variables?: Record<string, string | number>,
): string => translateDashboardMessage(shellMessages, locale, key, variables);

const getRelativeTime = (checkedAt: string, locale: DashboardLocale): string => {
  if (!checkedAt) {
    return shellText(locale, "justNow");
  }
  const elapsedMs = Math.max(0, Date.now() - new Date(checkedAt).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return shellText(locale, "justNow");
  }
  if (elapsedMinutes < 60) {
    return shellText(locale, "minutesAgo", { count: elapsedMinutes });
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return shellText(locale, "hoursAgo", { count: elapsedHours });
};

const deriveStartupNotifications = (
  readiness: OnboardingRuntimeReadiness | null,
  markAction: () => void,
  locale: DashboardLocale,
): Array<Omit<DashboardNotification, "unread">> => {
  if (!readiness) {
    return [{
      id: "startup-checks-loading",
      severity: "info",
      title: shellText(locale, "startupChecksLoading"),
      body: shellText(locale, "startupChecksLoadingBody"),
      time: shellText(locale, "justNow"),
      dismissible: false,
      icon: Info,
    }];
  }

  const notifications: Array<Omit<DashboardNotification, "unread">> = [];
  const missingRequired = readiness.dependencies.filter((dependency) => dependency.required && dependency.status === "missing");
  const warningDependencies = readiness.dependencies.filter((dependency) => dependency.status === "warning");
  const detectedProviders = readiness.providers.filter((provider) => provider.available);

  if (missingRequired.length > 0) {
    notifications.push({
      id: "startup-cluster-not-ready",
      severity: "critical",
      title: shellText(locale, "clusterNotReady"),
      body: shellText(locale, "clusterNotReadyBody", { dependencies: missingRequired.map((dependency) => dependency.label).join(", ") }),
      time: getRelativeTime(readiness.checkedAt, locale),
      dismissible: false,
      icon: AlertTriangle,
      actionLabel: shellText(locale, "openOnboarding"),
      onAction: markAction,
    });
  } else {
    notifications.push({
      id: "startup-cluster-ready",
      severity: "success",
      title: shellText(locale, "startupChecksPassed"),
      body: shellText(locale, "startupChecksPassedBody"),
      time: getRelativeTime(readiness.checkedAt, locale),
      dismissible: true,
      icon: CheckCircle,
    });
  }

  if (warningDependencies.length > 0) {
    notifications.push({
      id: "startup-dependency-warnings",
      severity: "warning",
      title: shellText(locale, "startupWarnings"),
      body: warningDependencies.map((dependency) => dependency.resolution).join(" "),
      time: getRelativeTime(readiness.checkedAt, locale),
      dismissible: true,
      icon: AlertTriangle,
    });
  }

  if (detectedProviders.length > 0) {
    notifications.push({
      id: "startup-provider-auth-detected",
      severity: "info",
      title: shellText(locale, "providerAuthDetected"),
      body: shellText(locale, "providerAuthDetectedBody", { providers: detectedProviders.map((provider) => provider.label).join(", ") }),
      time: getRelativeTime(readiness.checkedAt, locale),
      dismissible: true,
      icon: KeyRound,
      actionLabel: shellText(locale, "configure"),
      onAction: markAction,
    });
  } else {
    notifications.push({
      id: "startup-provider-auth-missing",
      severity: "warning",
      title: shellText(locale, "providerConfigurationRequired"),
      body: shellText(locale, "providerConfigurationRequiredBody"),
      time: getRelativeTime(readiness.checkedAt, locale),
      dismissible: false,
      icon: KeyRound,
      actionLabel: shellText(locale, "openOnboarding"),
      onAction: markAction,
    });
  }

  return notifications;
};

const deriveAgentSchedulerNotifications = (
  entries: AgentSchedulerSummaryEntry[],
  locale: DashboardLocale,
): Array<Omit<DashboardNotification, "unread">> => (
  entries.map((entry) => ({
    id: `scheduler-agent-${entry.id}`,
    severity: "info",
    title: shellText(locale, "scheduledTitle", { label: entry.label }),
    body: shellText(locale, "scheduledBody", { title: entry.title, target: entry.targetSummary, timing: entry.timingSummary, status: entry.statusLabel }),
    time: shellText(locale, "scheduled"),
    dismissible: true,
    icon: CalendarClock,
  }))
);

export const useNotifications = (projectId?: string | null): {
  notifications: DashboardNotification[];
  unreadCount: number;
  agentSchedules: AgentSchedulerSummaryEntry[];
  notificationFeedHydrated: boolean;
  refresh: () => Promise<void>;
  markAllRead: () => void;
  markRead: (id: string) => void;
  dismiss: (id: string) => void;
} => {
  const { locale } = useOptionalDashboardI18n();
  const [readiness, setReadiness] = useState<OnboardingRuntimeReadiness | null>(null);
  const [interventionFeed, setInterventionFeed] = useState<DashboardNotificationFeed>({
    notifications: [],
    updatedAt: null,
  });
  const [notificationFeedHydrated, setNotificationFeedHydrated] = useState(false);
  const [agentSchedules, setAgentSchedules] = useState<AgentSchedulerSummaryEntry[]>([]);
  const [storedState, setStoredState] = useState<StoredNotificationState>(() => readStoredState());
  const readinessRefreshRef = useRef<Promise<void> | null>(null);
  const notificationRefreshRef = useRef<Promise<void> | null>(null);
  const schedulerRefreshesRef = useRef<Map<string, Promise<void>>>(new Map());
  const currentProjectIdRef = useRef(projectId || null);
  currentProjectIdRef.current = projectId || null;

  const refreshReadiness = useCallback(async (force = false): Promise<void> => {
    if (!readinessRefreshRef.current) {
      const request = fetchOnboardingReadiness({ force })
        .then((nextReadiness) => {
          setReadiness((current) => isDeepEqual(current, nextReadiness) ? current : nextReadiness);
        })
        .finally(() => {
          if (readinessRefreshRef.current === request) {
            readinessRefreshRef.current = null;
          }
        });
      readinessRefreshRef.current = request;
    }
    await readinessRefreshRef.current;
  }, []);

  const refreshNotificationFeed = useCallback(async (): Promise<void> => {
    if (!notificationRefreshRef.current) {
      const request = fetchDashboardNotifications()
        .then((nextFeed) => {
          setInterventionFeed((current) => isDeepEqual(current, nextFeed) ? current : nextFeed);
        })
        .catch(() => undefined)
        .finally(() => {
          setNotificationFeedHydrated(true);
          if (notificationRefreshRef.current === request) {
            notificationRefreshRef.current = null;
          }
        });
      notificationRefreshRef.current = request;
    }
    await notificationRefreshRef.current;
  }, []);

  const refreshGlobal = useCallback(async (forceReadiness = false): Promise<void> => {
    await Promise.all([refreshReadiness(forceReadiness), refreshNotificationFeed()]);
  }, [refreshNotificationFeed, refreshReadiness]);

  const refreshScheduler = useCallback(async (): Promise<void> => {
    const requestedProjectId = projectId || null;
    if (!requestedProjectId) {
      setAgentSchedules((current) => current.length === 0 ? current : []);
      return;
    }
    const existing = schedulerRefreshesRef.current.get(requestedProjectId);
    if (existing) return existing;
    const request = fetchActiveAgentSchedulerEntries(requestedProjectId)
      .catch(() => [])
      .then((nextEntries) => {
        if (currentProjectIdRef.current === requestedProjectId) {
          setAgentSchedules((current) => isDeepEqual(current, nextEntries) ? current : nextEntries);
        }
      })
      .finally(() => {
        if (schedulerRefreshesRef.current.get(requestedProjectId) === request) {
          schedulerRefreshesRef.current.delete(requestedProjectId);
        }
      });
    schedulerRefreshesRef.current.set(requestedProjectId, request);
    return request;
  }, [projectId]);

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([refreshGlobal(), refreshScheduler()]);
  }, [refreshGlobal, refreshScheduler]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const handler = () => void Promise.all([refreshGlobal(true), refreshScheduler()]).catch(() => undefined);
    window.addEventListener("codeux:settings-updated", handler);
    return () => window.removeEventListener("codeux:settings-updated", handler);
  }, [refresh]);

  useEffect(() => {
    const scopes = projectId ? ["overview", `project:${projectId}`] : ["overview"];
    return subscribeToDashboardRealtime(scopes, (message) => {
      if (message.type === "snapshot_required") {
        void Promise.all([refreshNotificationFeed(), refreshScheduler()]).catch(() => undefined);
        return;
      }
      if (message.type !== "event") return;
      if (message.event.eventType === "overview.telemetry.updated") {
        void refreshNotificationFeed().catch(() => undefined);
      } else if (message.event.eventType === "project.structure.updated") {
        void refreshScheduler().catch(() => undefined);
      }
    });
  }, [projectId, refreshNotificationFeed, refreshScheduler]);

  const updateStoredState = useCallback((recipe: (current: StoredNotificationState) => StoredNotificationState): void => {
    setStoredState((current) => {
      const next = recipe(current);
      if (next === current) return current;
      writeStoredState(next);
      return next;
    });
  }, []);

  const notifications = useMemo(() => {
    const base = [
      ...deriveStartupNotifications(readiness, openOnboarding, locale),
      ...interventionFeed.notifications.map((notification) => toNotificationViewModel(notification, Date.now(), locale)),
      ...deriveAgentSchedulerNotifications(agentSchedules, locale),
    ];
    return base
      .filter((notification) => !storedState.dismissedIds.includes(notification.id))
      .map((notification) => ({
        ...notification,
        unread: !storedState.readIds.includes(notification.id),
      }));
  }, [agentSchedules, interventionFeed, locale, readiness, storedState.dismissedIds, storedState.readIds]);

  const markRead = useCallback((id: string): void => {
    updateStoredState((current) => current.readIds.includes(id) ? current : {
      ...current,
      readIds: [...current.readIds, id],
    });
  }, [updateStoredState]);

  const dismiss = useCallback((id: string): void => {
    updateStoredState((current) => current.dismissedIds.includes(id) ? current : ({
      readIds: current.readIds.includes(id) ? current.readIds : [...current.readIds, id],
      dismissedIds: [...current.dismissedIds, id],
    }));
  }, [updateStoredState]);

  const markAllRead = useCallback((): void => {
    updateStoredState((current) => {
      const unreadIds = notifications
        .map((notification) => notification.id)
        .filter((id) => !current.readIds.includes(id));
      return unreadIds.length === 0 ? current : {
        ...current,
        readIds: [...current.readIds, ...unreadIds],
      };
    });
  }, [notifications, updateStoredState]);

  return {
    notifications,
    unreadCount: notifications.filter((notification) => notification.unread).length,
    agentSchedules,
    notificationFeedHydrated,
    refresh,
    markAllRead,
    markRead,
    dismiss,
  };
};
