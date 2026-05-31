import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { fetchSystemSettings, saveSystemSettings } from "../lib/settings-api.js";
import type { DashboardSettings, SystemSettings } from "../../types.js";

type ThemeSetting = DashboardSettings["appearance"]["theme"];

const normalizeTheme = (value: unknown): ThemeSetting => {
  if (typeof value !== "string") {
    return "SYSTEM";
  }
  const upper = value.toUpperCase();
  if (upper === "LIGHT" || upper === "DARK" || upper === "SYSTEM") {
    return upper;
  }
  return "SYSTEM";
};

const applyThemeToSettings = (current: SystemSettings, theme: ThemeSetting): SystemSettings => ({
  ...current,
  defaults: {
    ...current.defaults,
    appearance: {
      ...current.defaults.appearance,
      theme,
    },
  },
});

let sharedSystemSettings: SystemSettings | null = null;
let sharedTheme: ThemeSetting = "SYSTEM";
let sharedSaving = false;
let sharedInflight: Promise<void> | null = null;
let sharedQueuedTheme: ThemeSetting | null = null;
const subscribers = new Set<() => void>();

const notifySubscribers = (): void => {
  subscribers.forEach((subscriber) => subscriber());
};

const syncSharedTheme = (settings: SystemSettings): void => {
  sharedSystemSettings = settings;
  sharedTheme = normalizeTheme(settings.defaults.appearance.theme);
  notifySubscribers();
};

export const useThemeSetting = () => {
  const [theme, setThemeState] = useState<ThemeSetting>(sharedTheme);
  const [saving, setSaving] = useState(sharedSaving);
  const mountedRef = useRef(true);

  const loadSettings = useCallback(async () => {
    const settings = await fetchSystemSettings();
    syncSharedTheme(settings);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const refreshFromSharedState = () => {
      if (!mountedRef.current) {
        return;
      }
      setThemeState(sharedTheme);
      setSaving(sharedSaving);
    };
    subscribers.add(refreshFromSharedState);
    refreshFromSharedState();
    void loadSettings();
    return () => {
      mountedRef.current = false;
      subscribers.delete(refreshFromSharedState);
    };
  }, [loadSettings]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (!detail || detail.scope === "system") {
        void loadSettings();
      }
    };
    window.addEventListener("codeux:settings-updated", handleUpdated);
    return () => window.removeEventListener("codeux:settings-updated", handleUpdated);
  }, [loadSettings]);

  const flushQueuedTheme = useCallback(async () => {
    if (sharedInflight) {
      return sharedInflight;
    }
    sharedInflight = (async () => {
      sharedSaving = true;
      notifySubscribers();
      try {
        while (sharedQueuedTheme) {
          const themeToSave = sharedQueuedTheme;
          sharedQueuedTheme = null;

          const base = sharedSystemSettings ?? await fetchSystemSettings();
          const updated = applyThemeToSettings(base, themeToSave);
          const saved = await saveSystemSettings(updated);
          syncSharedTheme(saved);
        }
      } finally {
        sharedSaving = false;
        sharedInflight = null;
        notifySubscribers();
      }
    })();
    return sharedInflight;
  }, []);

  const saveTheme = useCallback((nextTheme: ThemeSetting) => {
    sharedTheme = nextTheme;
    sharedQueuedTheme = nextTheme;
    notifySubscribers();
    void flushQueuedTheme().catch(() => {
      sharedQueuedTheme = null;
      sharedSaving = false;
      sharedInflight = null;
      void loadSettings();
    });
  }, [flushQueuedTheme, loadSettings]);

  const resolvedTheme = useMemo(() => normalizeTheme(theme), [theme]);

  return {
    theme: resolvedTheme,
    setTheme: saveTheme,
    saving,
  };
};
