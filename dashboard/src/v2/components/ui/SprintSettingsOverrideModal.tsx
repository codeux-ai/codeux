import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Check, RefreshCw, SlidersHorizontal, X } from "lucide-preact";
import type { Sprint } from "../../types.js";
import { ProjectSettingsEditor } from "../settings/ProjectSettingsEditor.js";
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
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timeoutId = window.setTimeout(() => setMessage(null), 2200);
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
      ref={backdropRef}
      onClick={(event) => {
        if (event.target === backdropRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/55 px-6 py-8 backdrop-blur-xl dark:bg-black/75"
    >
      <div
        ref={cardRef}
        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2.5rem] bg-[#f9f8f4] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:bg-void-900 dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-black/[0.06] px-8 py-7 dark:border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-signal-500">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2.3} />
              Sprint Overrides
            </div>
            <h2 className="mt-3 font-display text-4xl font-black tracking-tight text-slate-900 dark:text-white">
              {sprint.name}
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              Sprint settings override the resolved project configuration for this sprint only. Saving from this dialog stays sparse on the backend.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void loadSettings(); }}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2.1} />
              Reload
            </button>
            <button
              type="button"
              onClick={() => { void handleReset(); }}
              disabled={resetting}
              className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-status-red disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resetting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : null}
              Reset
            </button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-void-900 transition-colors hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.1} />}
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05] text-slate-500 transition-colors hover:text-slate-900 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:text-white"
            >
              <X className="h-4 w-4" strokeWidth={2.1} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-8 py-7">
          {error ? (
            <div className="mb-5 rounded-[1.5rem] border border-status-red/20 bg-status-red/10 px-5 py-4 text-sm font-medium text-status-red">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="mb-5 rounded-[1.5rem] border border-signal-500/20 bg-signal-500/[0.08] px-5 py-4 text-sm font-medium text-signal-600 dark:text-signal-300">
              {message}
            </div>
          ) : null}

          {loading || !settings ? (
            <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 px-5 py-8 text-sm font-medium text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
              Loading sprint overrides...
            </div>
          ) : (
            <ProjectSettingsEditor settings={settings} onChange={setSettings} sources={sources} />
          )}
        </div>
      </div>
    </div>
  );
};
