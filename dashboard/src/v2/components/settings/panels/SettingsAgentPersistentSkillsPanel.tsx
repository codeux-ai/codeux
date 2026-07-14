import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Database } from "lucide-preact";
import type { SkillStorageRecord } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
import { fetchSkillStorages, updateAgentPreset } from "../../../lib/agent-preset-api.js";
import { PersistentSkillStorageManager } from "../PersistentSkillStorageManager.js";
import { Row, Toggle } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";

type AgentSkillState = {
  storageIds: string[];
  enabled: boolean;
};

export interface SettingsAgentPersistentSkillsPanelProps {
  state: SettingsPageState;
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const EMPTY_AGENT_PRESETS: NonNullable<SettingsPageState["projectAgentPresets"]> = [];

const reconcileAgentSkillState = (
  state: AgentSkillState,
  validStorageIds: ReadonlySet<string> | null,
): AgentSkillState => {
  if (!validStorageIds) return state;
  const storageIds = state.storageIds.filter((storageId) => validStorageIds.has(storageId));
  return {
    storageIds,
    enabled: storageIds.length > 0 && state.enabled,
  };
};

export const SettingsAgentPersistentSkillsPanel: FunctionComponent<SettingsAgentPersistentSkillsPanelProps> = ({ state }) => {
  const { translate } = useDashboardI18n();
  const { selectedProject, projectAgentPresets = EMPTY_AGENT_PRESETS } = state;
  const [storages, setStorages] = useState<SkillStorageRecord[]>([]);
  const [agentState, setAgentState] = useState<Record<string, AgentSkillState>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const validStorageIdsRef = useRef<ReadonlySet<string> | null>(null);

  const handleStoragesChange = useCallback((records: SkillStorageRecord[]): void => {
    const validStorageIds = new Set(records.map((storage) => storage.id));
    validStorageIdsRef.current = validStorageIds;
    setStorages(records);
    setAgentState((current) => Object.fromEntries(Object.entries(current).map(([presetId, presetState]) => [
      presetId,
      reconcileAgentSkillState(presetState, validStorageIds),
    ])));
  }, []);

  useEffect(() => {
    setAgentState(Object.fromEntries(projectAgentPresets.map((preset) => [preset.id, {
      storageIds: [...(preset.persistentSkillStorageIds ?? [])],
      enabled: Boolean(preset.persistentSkillStorage?.enabled),
    }])));
  }, [projectAgentPresets]);

  useEffect(() => {
    let cancelled = false;
    validStorageIdsRef.current = null;
    setStorages([]);
    setError(null);
    if (!selectedProject) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    fetchSkillStorages(selectedProject.id)
      .then((records) => {
        if (!cancelled) handleStoragesChange(records);
      })
      .catch((loadError) => {
        if (!cancelled) setError(translate(settingsAgentsGuidanceMessages, "skillsLoadError", { error: errorMessage(loadError) }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [handleStoragesChange, selectedProject?.id, translate]);

  const storageNames = useMemo(() => new Map(storages.map((storage) => [storage.id, storage.name])), [storages]);

  const getPresetState = (presetId: string): AgentSkillState => reconcileAgentSkillState(
    agentState[presetId] ?? { storageIds: [], enabled: false },
    validStorageIdsRef.current,
  );

  const toggleStorage = async (presetId: string, storageId: string): Promise<void> => {
    if (busy) return;
    if (validStorageIdsRef.current && !validStorageIdsRef.current.has(storageId)) return;
    const current = getPresetState(presetId);
    const storageIds = current.storageIds.includes(storageId)
      ? current.storageIds.filter((id) => id !== storageId)
      : [...current.storageIds, storageId];
    const enabled = storageIds.length > 0 && current.enabled;
    setBusy(`attach:${presetId}:${storageId}`);
    try {
      await updateAgentPreset(presetId, {
        persistentSkillStorageIds: storageIds,
        persistentSkillStorage: { enabled },
      });
      setAgentState((value) => ({
        ...value,
        [presetId]: reconcileAgentSkillState({ storageIds, enabled }, validStorageIdsRef.current),
      }));
      setError(null);
    } catch (updateError) {
      setError(translate(settingsAgentsGuidanceMessages, "skillsAttachmentError", { error: errorMessage(updateError) }));
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (presetId: string, requestedEnabled: boolean): Promise<void> => {
    if (busy) return;
    const current = getPresetState(presetId);
    const enabled = requestedEnabled && current.storageIds.length > 0;
    setBusy(`enable:${presetId}`);
    try {
      await updateAgentPreset(presetId, {
        persistentSkillStorageIds: current.storageIds,
        persistentSkillStorage: { enabled },
      });
      setAgentState((value) => ({
        ...value,
        [presetId]: reconcileAgentSkillState({ ...current, enabled }, validStorageIdsRef.current),
      }));
      setError(null);
    } catch (updateError) {
      setError(translate(settingsAgentsGuidanceMessages, "skillsRetrievalError", { error: errorMessage(updateError) }));
    } finally {
      setBusy(null);
    }
  };

  const statusSummary = !selectedProject
    ? translate(settingsAgentsGuidanceMessages, "skillsSelectProjectSummary")
    : loading
      ? translate(settingsAgentsGuidanceMessages, "skillsLoadingSummary")
      : translate(settingsAgentsGuidanceMessages, "skillsAvailableSummary", {
        storageCount: storages.length,
        storageNoun: translate(settingsAgentsGuidanceMessages, storages.length === 1 ? "skillsStorageSingular" : "skillsStoragePlural"),
        agentCount: projectAgentPresets.length,
        agentNoun: translate(settingsAgentsGuidanceMessages, projectAgentPresets.length === 1 ? "skillsAgentSingular" : "skillsAgentPlural"),
      });

  return (
    <SectionCard
      title={translate(settingsAgentsGuidanceMessages, "skillsTitle")}
      watermark="SKL"
      icon={<Database strokeWidth={2.4} />}
      accent="teal"
      summary={translate(settingsAgentsGuidanceMessages, "skillsSummary")}
      configureLabel={translate(settingsAgentsGuidanceMessages, "skillsConfigure")}
      highlights={[
        { label: translate(settingsAgentsGuidanceMessages, "skillsStorages"), value: loading ? translate(settingsAgentsGuidanceMessages, "loading") : storages.length, tone: storages.length > 0 ? "active" : "neutral" },
        { label: translate(settingsAgentsGuidanceMessages, "skillsProjectAgents"), value: projectAgentPresets.length },
        { label: translate(settingsAgentsGuidanceMessages, "skillsRetrievalEnabled"), value: Object.values(agentState).filter((entry) => entry.enabled && entry.storageIds.length > 0).length },
      ]}
    >
      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(16rem,1.3fr)]">
        <div className="min-w-0 rounded-[1.2rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">{translate(settingsAgentsGuidanceMessages, "skillsStatus")}</span>
            {!selectedProject ? <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">{translate(settingsAgentsGuidanceMessages, "projectOnly")}</span> : null}
          </div>
          <p role="status" aria-live="polite" className="mt-2 text-sm font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{statusSummary}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsSeparateFromMemory")}</p>
        </div>
        <PersistentSkillStorageManager project={selectedProject ?? null} storages={storages} onStoragesChange={handleStoragesChange} />
      </div>

      {error ? (
        <div role="alert" className="rounded-[1rem] border border-status-red/25 bg-status-red/[0.08] px-4 py-3 text-xs font-semibold text-status-red">{error}</div>
      ) : null}

      <Row label={translate(settingsAgentsGuidanceMessages, "skillsAttachmentsLabel")} description={translate(settingsAgentsGuidanceMessages, "skillsAttachmentsDescription")} last>
        <div className="grid min-w-0 w-full gap-3" aria-busy={busy ? "true" : undefined}>
          {!selectedProject ? (
            <div role="status" className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsSelectProjectAttachments")}</div>
          ) : loading ? (
            <div role="status" className="rounded-[1rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs font-semibold text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsLoadingAttachments")}</div>
          ) : projectAgentPresets.length === 0 ? (
            <div role="status" className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsCreateAgentsFirst")}</div>
          ) : projectAgentPresets.map((preset) => {
            const current = getPresetState(preset.id);
            const active = current.enabled && current.storageIds.length > 0;
            const toggleReasonId = `persistent-skills-${preset.id}-reason`;
            const enableDisabled = current.storageIds.length === 0 || Boolean(busy);
            return (
              <section key={preset.id} aria-label={translate(settingsAgentsGuidanceMessages, "skillsSectionAria", { name: preset.name })} className="min-w-0 rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{preset.name}</div>
                    <div id={toggleReasonId} className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {current.storageIds.length === 0
                        ? translate(settingsAgentsGuidanceMessages, "skillsAttachBeforeEnable")
                        : active
                          ? translate(settingsAgentsGuidanceMessages, "skillsRetrievalActive")
                          : translate(settingsAgentsGuidanceMessages, "skillsRetrievalInactive")}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${active ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"}`}>{translate(settingsAgentsGuidanceMessages, active ? "enabled" : "skillsDefaultOff")}</span>
                    <Toggle
                      aria-label={translate(settingsAgentsGuidanceMessages, "skillsEnableAria", { name: preset.name })}
                      aria-describedby={toggleReasonId}
                      value={active}
                      disabled={enableDisabled}
                      onChange={(value) => void toggleEnabled(preset.id, value)}
                    />
                  </div>
                </div>
                <fieldset className="mt-3 min-w-0" disabled={Boolean(busy) || storages.length === 0}>
                  <legend className="sr-only">{translate(settingsAgentsGuidanceMessages, "skillsAttachmentsLegend", { name: preset.name })}</legend>
                  {storages.length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsNoStorages")}</span>
                  ) : (
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {storages.map((storage) => {
                        const checked = current.storageIds.includes(storage.id);
                        return (
                          <label key={`${preset.id}:${storage.id}`} className={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors motion-reduce:transition-none ${checked ? "border-signal-500/30 bg-signal-500/[0.1] text-signal-800 dark:text-signal-100" : "border-black/[0.06] bg-black/[0.02] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => void toggleStorage(preset.id, storage.id)}
                              className="h-4 w-4 shrink-0 rounded border-black/20 text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)]"
                            />
                            <span className="min-w-0 break-words">{storageNames.get(storage.id) ?? storage.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
                {busy ? <div role="status" className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "skillsSavingAttachments")}</div> : null}
              </section>
            );
          })}
        </div>
      </Row>
    </SectionCard>
  );
};
