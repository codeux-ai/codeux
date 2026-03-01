import { useCallback, useState } from "preact/hooks";
import { fetchDashboardSettings, fetchExternalSettingsHints, saveDashboardSettings } from "../lib/api/dashboard-api.js";
import { applyExternalSettingsHints, cloneDefaultSettings } from "../lib/settings.js";
import type { DashboardSettings } from "../types.js";

interface UseDashboardSettingsResult {
  fetchSettings: () => Promise<void>;
  importMissingSettings: () => Promise<void>;
  isLoading: boolean;
  isSaving: boolean;
  saveMessage: string | null;
  saveSettings: () => Promise<boolean>;
  settings: DashboardSettings;
  settingsError: string | null;
  setSettings: (next: DashboardSettings) => void;
}

export const useDashboardSettings = (): UseDashboardSettingsResult => {
  const [settings, setSettings] = useState<DashboardSettings>(cloneDefaultSettings());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const fetchSettings = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const data = await fetchDashboardSettings();
      setSettings(data);
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to load settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const data = await saveDashboardSettings(settings);
      setSettings(data);
      setSettingsError(null);
      setSaveMessage("Settings saved.");
      return true;
    } catch {
      setSettingsError("Unable to save settings");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  const importMissingSettings = useCallback(async (): Promise<void> => {
    try {
      const hints = await fetchExternalSettingsHints();
      setSettings((prev) => applyExternalSettingsHints(prev, hints));
      setSaveMessage("Imported missing values from .env/.jules-subagents/settings.json.");
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to import settings from .env/.json");
    }
  }, []);

  return {
    fetchSettings,
    importMissingSettings,
    isLoading,
    isSaving,
    saveMessage,
    saveSettings,
    settings,
    settingsError,
    setSettings,
  };
};
