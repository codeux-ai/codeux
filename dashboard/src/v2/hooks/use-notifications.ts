import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AlertTriangle, CheckCircle, HelpCircle, Info, KeyRound, type LucideIcon } from "lucide-preact";
import { fetchOnboardingReadiness } from "../../lib/api/dashboard-api.js";
import type { OnboardingRuntimeReadiness } from "../../types.js";
import { openOnboarding } from "../lib/onboarding-control.js";

const NOTIFICATION_STATE_KEY = "codeux:notification-state:v1";

export type NotificationSeverity = "critical" | "warning" | "success" | "info";

export interface DashboardNotification {
  id: string;
  type?: "intervention";
  severity: NotificationSeverity;
  title: string;
  body?: string;
  subtitle?: string;
  time: string;
  unread: boolean;
  dismissible: boolean;
  icon: LucideIcon;
  iconColor?: string;
  actionLabel?: string;
  onAction?: () => void;
}

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
  }

  notifications.push({
    id: "4",
    type: "intervention",
    severity: "warning",
    title: "Human Intervention Required",
    subtitle: "Task T01 in sprint SPR-10 requires manual decision.",
    time: "3m ago",
    dismissible: true,
    icon: HelpCircle,
    iconColor: "text-status-amber",
  });

  return notifications;
};

export const useNotifications = (): {
  notifications: DashboardNotification[];
  unreadCount: number;
  refresh: () => Promise<void>;
  markAllRead: () => void;
  markRead: (id: string) => void;
  dismiss: (id: string) => void;
} => {
  const [readiness, setReadiness] = useState<OnboardingRuntimeReadiness | null>(null);
  const [storedState, setStoredState] = useState<StoredNotificationState>(() => readStoredState());

  const refresh = useCallback(async (): Promise<void> => {
    const nextReadiness = await fetchOnboardingReadiness();
    setReadiness(nextReadiness);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const handler = () => void refresh().catch(() => undefined);
    window.addEventListener("codeux:settings-updated", handler);
    return () => window.removeEventListener("codeux:settings-updated", handler);
  }, [refresh]);

  const updateStoredState = useCallback((recipe: (current: StoredNotificationState) => StoredNotificationState): void => {
    setStoredState((current) => {
      const next = recipe(current);
      writeStoredState(next);
      return next;
    });
  }, []);

  const notifications = useMemo(() => {
    const base = deriveStartupNotifications(readiness, openOnboarding);
    return base
      .filter((notification) => !storedState.dismissedIds.includes(notification.id))
      .map((notification) => ({
        ...notification,
        unread: !storedState.readIds.includes(notification.id),
      }));
  }, [readiness, storedState.dismissedIds, storedState.readIds]);

  const markRead = useCallback((id: string): void => {
    updateStoredState((current) => ({
      ...current,
      readIds: [...current.readIds, id],
    }));
  }, [updateStoredState]);

  const dismiss = useCallback((id: string): void => {
    updateStoredState((current) => ({
      readIds: [...current.readIds, id],
      dismissedIds: [...current.dismissedIds, id],
    }));
  }, [updateStoredState]);

  const markAllRead = useCallback((): void => {
    updateStoredState((current) => ({
      ...current,
      readIds: [...current.readIds, ...notifications.map((notification) => notification.id)],
    }));
  }, [notifications, updateStoredState]);

  return {
    notifications,
    unreadCount: notifications.filter((notification) => notification.unread).length,
    refresh,
    markAllRead,
    markRead,
    dismiss,
  };
};
