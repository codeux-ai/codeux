import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Check, RefreshCw, SlidersHorizontal, X, Zap } from "lucide-preact";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import type { Sprint } from "../../types.js";
import { ProjectSettingsEditor } from "../settings/ProjectSettingsEditor.js";
import { ActionButton, SettingsBody, SettingsHeader } from "../settings/SettingsSurface.js";
import {
  fetchSprintEffectiveSettings,
  resetSprintSettings,
  saveSprintSettings,
} from "../../lib/settings-api.js";
import {
  cloneProjectSettings,
  dashboardSettingsToProjectSettings,
} from "../../lib/settings-view-models.js";
import type { ProjectSettings, SettingsValueSource } from "../../../types.js";

interface SprintSettingsOverrideModalProps {
  projectId: string;
  sprint: Sprint;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export const SprintSettingsOverrideModal: FunctionComponent<SprintSettingsOverrideModalProps> = ({
  projectId,
  sprint,
  onClose,
  onSaved,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<ProjectSettings | null>(null);
  const [sources, setSources] = useState<Record<string, SettingsValueSource>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const trapRef = useFocusTrap(true, onClose);

  const loadSettings = async (): Promise<void> => {
    setLoading(true);
    try {
      const effective = await fetchSprintEffectiveSettings(projectId, sprint.id);
      const nextSettings = dashboardSettingsToProjectSettings(effective.settings);
      setSettings(cloneProjectSettings(nextSettings));
      setSavedSettings(cloneProjectSettings(nextSettings));
      setSources(effective.sources);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    gsap.fromTo(cardRef.current, { y: 42, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power4.out" });
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [projectId, sprint.id]);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timeoutId = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const dirty = settings && savedSettings
    ? JSON.stringify(settings) !== JSON.stringify(savedSettings)
    : false;

  const handleSave = async () => {
    if (!settings) {
      return;
    }
    setSaving(true);
    try {
      await saveSprintSettings(projectId, sprint.id, settings);
      await loadSettings();
      await onSaved();
      setMessage("Sprint overrides saved.");
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetSprintSettings(sprint.id);
      await loadSettings();
      await onSaved();
      setMessage("Sprint overrides reset.");
      setError(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div
      ref={trapRef}
      onClick={(event) => {
        if (event.target === backdropRef.current || event.target === trapRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[240] flex items-center justify-center px-6 py-8"
    >
      <div ref={backdropRef} className="absolute inset-0 bg-black/55 backdrop-blur-xl dark:bg-black/75" />
      <div
        ref={cardRef}
        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2.5rem] bg-[#f9f8f4] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:bg-void-900 dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)]"
      >
        <SettingsHeader
          icon={SlidersHorizontal}
          eyebrow="Sprint Overrides"
          title={sprint.name}
          description="Sprint settings override the resolved project configuration for this sprint only. Saving from this dialog stays sparse on the backend."
          actions={
            <>
              <ActionButton
                label="Reload"
                onClick={() => { void loadSettings(); }}
                busy={loading}
              />
              <ActionButton
                label="Reset"
                onClick={() => { void handleReset(); }}
                tone="danger"
                busy={resetting}
              />
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={!dirty || saving}
                className={`group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${
                  message && !error
                    ? "bg-status-green text-white shadow-[0_4px_20px_rgba(0,171,132,0.3)]"
                    : "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
                }`}
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                    Saving
                  </>
                ) : message && !error ? (
                  <>
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                    Saved
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" strokeWidth={2} />
                    Save Changes
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05] text-slate-500 transition-colors hover:text-slate-900 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
              >
                <X className="h-4 w-4" strokeWidth={2.1} />
              </button>
            </>
          }
        />

        <div className="overflow-y-auto">
          <SettingsBody
            error={error}
            message={message}
            loading={loading || !settings}
            loadingLabel="Loading sprint overrides\u2026"
          >
            {settings ? (
              <ProjectSettingsEditor settings={settings} onChange={setSettings} sources={sources} editingScope="sprint" />
            ) : null}
          </SettingsBody>
        </div>
      </div>
    </div>
  );
};
