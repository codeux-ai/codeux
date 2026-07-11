import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, CalendarClock, CheckCircle, Info, KeyRound } from "lucide-preact";
import { fetchDashboardNotifications, fetchOnboardingReadiness } from "../../lib/api/dashboard-api.js";
import type { DashboardNotificationFeed, OnboardingRuntimeReadiness } from "../../types.js";
import { openOnboarding } from "../lib/onboarding-control.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { fetchActiveAgentSchedulerEntries, type AgentSchedulerSummaryEntry } from "../lib/scheduler-api.js";
import { isDeepEqual } from "../lib/resource-equality.js";
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

const getRelativeTime = (checkedAt: string): string => {
  if (!checkedAt) {
    return "just now";
  }
  const elapsedMs = Math.max(0, Date.now() - new Date(checkedAt).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return "just now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
};

const deriveStartupNotifications = (
  readiness: OnboardingRuntimeReadiness | null,
  markAction: () => void,
): Array<Omit<DashboardNotification, "unread">> => {
  if (!readiness) {
    return [{
      id: "startup-checks-loading",
      severity: "info",
      title: "Startup checks loading",
      body: "Code UX is checking Docker, Git, and provider credentials.",
      time: "just now",
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
      title: "Cluster not ready",
      body: `${missingRequired.map((dependency) => dependency.label).join(", ")} must be available before containerized provider CLIs can run.`,
      time: getRelativeTime(readiness.checkedAt),
      dismissible: false,
      icon: AlertTriangle,
      actionLabel: "Open onboarding",
      onAction: markAction,
    });
  } else {
    notifications.push({
      id: "startup-cluster-ready",
      severity: "success",
      title: "Startup checks passed",
      body: "Docker, Git, and required runtime checks are ready for local container execution.",
      time: getRelativeTime(readiness.checkedAt),
      dismissible: true,
      icon: CheckCircle,
    });
  }

  if (warningDependencies.length > 0) {
    notifications.push({
      id: "startup-dependency-warnings",
      severity: "warning",
      title: "Startup warnings",
      body: warningDependencies.map((dependency) => dependency.resolution).join(" "),
      time: getRelativeTime(readiness.checkedAt),
      dismissible: true,
      icon: AlertTriangle,
    });
  }

  if (detectedProviders.length > 0) {
    notifications.push({
      id: "startup-provider-auth-detected",
      severity: "info",
      title: "Provider auth detected",
      body: `${detectedProviders.map((provider) => provider.label).join(", ")} local auth can be activated for container runs.`,
      time: getRelativeTime(readiness.checkedAt),
      dismissible: true,
      icon: KeyRound,
      actionLabel: "Configure",
      onAction: markAction,
    });
  } else {
    notifications.push({
      id: "startup-provider-auth-missing",
      severity: "warning",
      title: "Provider configuration required",
      body: "No usable provider authentication was detected. Configure at least one provider before starting agent work.",
      time: getRelativeTime(readiness.checkedAt),
      dismissible: false,
      icon: KeyRound,
      actionLabel: "Open onboarding",
      onAction: markAction,
    });
  }

  return notifications;
};

const deriveAgentSchedulerNotifications = (
  entries: AgentSchedulerSummaryEntry[],
): Array<Omit<DashboardNotification, "unread">> => (
  entries.map((entry) => ({
    id: `scheduler-agent-${entry.id}`,
    severity: "info",
    title: `${entry.label} scheduled`,
    body: `${entry.title}. ${entry.targetSummary}. ${entry.timingSummary}. Status: ${entry.statusLabel}.`,
    time: "Scheduled",
    dismissible: true,
    icon: CalendarClock,
  }))
);

export const useNotifications = (projectId?: string | null): {
  notifications: DashboardNotification[];
  unreadCount: number;
  agentSchedules: AgentSchedulerSummaryEntry[];
  refresh: () => Promise<void>;
  markAllRead: () => void;
  markRead: (id: string) => void;
  dismiss: (id: string) => void;
} => {
  const [readiness, setReadiness] = useState<OnboardingRuntimeReadiness | null>(null);
  const [interventionFeed, setInterventionFeed] = useState<DashboardNotificationFeed>({
    notifications: [],
    updatedAt: null,
  });
  const [agentSchedules, setAgentSchedules] = useState<AgentSchedulerSummaryEntry[]>([]);
  const [storedState, setStoredState] = useState<StoredNotificationState>(() => readStoredState());
  const globalRefreshRef = useRef<Promise<void> | null>(null);
  const schedulerRefreshesRef = useRef<Map<string, Promise<void>>>(new Map());
  const currentProjectIdRef = useRef(projectId || null);
  currentProjectIdRef.current = projectId || null;

  const refreshGlobal = useCallback(async (): Promise<void> => {
    if (!globalRefreshRef.current) {
      const request = Promise.all([
        fetchOnboardingReadiness().then((nextReadiness) => {
          setReadiness((current) => isDeepEqual(current, nextReadiness) ? current : nextReadiness);
        }),
        fetchDashboardNotifications().then((nextFeed) => {
          setInterventionFeed((current) => isDeepEqual(current, nextFeed) ? current : nextFeed);
        }).catch(() => undefined),
      ]).then(() => undefined).finally(() => {
        if (globalRefreshRef.current === request) {
          globalRefreshRef.current = null;
        }
      });
      globalRefreshRef.current = request;
    }
    await globalRefreshRef.current;
  }, []);

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
    const handler = () => void refresh().catch(() => undefined);
    window.addEventListener("codeux:settings-updated", handler);
    return () => window.removeEventListener("codeux:settings-updated", handler);
  }, [refresh]);

  useEffect(() => {
    const scopes = projectId ? ["overview", `project:${projectId}`] : ["overview"];
    return subscribeToDashboardRealtime(scopes, (message) => {
      if (message.type === "snapshot_required") {
        void refresh().catch(() => undefined);
        return;
      }
      if (message.type !== "event") return;
      if (message.event.eventType === "overview.telemetry.updated") {
        void refreshGlobal().catch(() => undefined);
      } else if (
        message.event.eventType === "project.structure.updated"
        || message.event.eventType === "project.execution.updated"
      ) {
        void refreshScheduler().catch(() => undefined);
      }
    });
  }, [projectId, refresh, refreshGlobal, refreshScheduler]);

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
      ...deriveStartupNotifications(readiness, openOnboarding),
      ...interventionFeed.notifications.map((notification) => toNotificationViewModel(notification)),
      ...deriveAgentSchedulerNotifications(agentSchedules),
    ];
    return base
      .filter((notification) => !storedState.dismissedIds.includes(notification.id))
      .map((notification) => ({
        ...notification,
        unread: !storedState.readIds.includes(notification.id),
      }));
  }, [agentSchedules, interventionFeed, readiness, storedState.dismissedIds, storedState.readIds]);

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
    refresh,
    markAllRead,
    markRead,
    dismiss,
  };
};
