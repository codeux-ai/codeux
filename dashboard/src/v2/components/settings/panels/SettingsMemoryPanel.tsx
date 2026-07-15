import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, SecretInput, Toggle, TextInput, TextAreaInput } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { BookOpen, Brain, CalendarClock, Gauge } from "lucide-preact";
import { fetchMemoryRemediationSchedule, saveMemoryRemediationSchedule } from "../../../lib/scheduler-api.js";
import type { MemoryRemediationScheduleCadence } from "../../../types.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsModelsMessages } from "../../../i18n/messages/settings-models.js";
import { AvantgardeSelect } from "../../ui/AvantgardeSelect.js";

export const SettingsMemoryPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { formatNumber, translate: t, translatePlural: tp } = useDashboardI18n();
  const {
    activeScope,
    selectedProject,
    editableSettings,
    projectSources,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);
  const [scheduleCadence, setScheduleCadence] = useState<MemoryRemediationScheduleCadence>("off");
  const [scheduleMode, setScheduleMode] = useState<"deterministic" | "ai">("deterministic");
  const [scheduleTime, setScheduleTime] = useState("03:00");
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  useEffect(() => {
    if (!selectedProject?.id || activeScope !== "project") {
      setScheduleCadence("off");
      setScheduleMode("deterministic");
      setScheduleMessage(null);
      setScheduleError(null);
      return;
    }

    const controller = new AbortController();
    setScheduleLoading(true);
    fetchMemoryRemediationSchedule(selectedProject.id, controller.signal)
      .then((response) => {
        setScheduleCadence(response.cadence);
        setScheduleMode(response.mode);
        if (response.entry) {
          setScheduleTime(toTimeInputValue(response.entry.scheduledFor));
        }
        setScheduleError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setScheduleError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setScheduleLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeScope, selectedProject?.id]);

  const saveSchedule = async (): Promise<void> => {
    if (!selectedProject?.id) return;
    setScheduleSaving(true);
    try {
      const response = await saveMemoryRemediationSchedule(selectedProject.id, {
        cadence: scheduleCadence,
        mode: scheduleMode,
        scheduledFor: scheduleCadence === "off" ? undefined : nextLocalOccurrenceIso(scheduleTime, scheduleCadence),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setScheduleCadence(response.cadence);
      setScheduleMode(response.mode);
      if (response.entry) {
        setScheduleTime(toTimeInputValue(response.entry.scheduledFor));
      }
      setScheduleMessage(t(settingsModelsMessages, response.cadence === "off" ? "schedulePaused" : "scheduleSaved"));
      setScheduleError(null);
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : String(error));
      setScheduleMessage(null);
    } finally {
      setScheduleSaving(false);
    }
  };

    if (!editableSettings) {
      return null;
    }

    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title={t(settingsModelsMessages, "memorySystem")}
          helpId="memory-system"
          summary={t(settingsModelsMessages, "memorySystemSummary")}
          configureLabel={t(settingsModelsMessages, "configure")}
          watermark="MEM"
          badge={getBadge("memory")}
          icon={<Brain strokeWidth={2.4} />}
          highlights={[
            { label: t(settingsModelsMessages, "memory"), value: editableSettings.memory.enabled ? t(settingsModelsMessages, "enabled") : t(settingsModelsMessages, "off"), tone: editableSettings.memory.enabled ? "active" : "warning" },
            { label: t(settingsModelsMessages, "capture"), value: editableSettings.memory.autoCaptureSprint || editableSettings.memory.autoCaptureAgent ? t(settingsModelsMessages, "automatic") : t(settingsModelsMessages, "manual") },
            { label: t(settingsModelsMessages, "remediation"), value: editableSettings.memory.remediationMode === "ai" ? "AI" : editableSettings.memory.remediationMode === "deterministic" ? t(settingsModelsMessages, "deterministic") : t(settingsModelsMessages, "off") },
          ]}
        >
          <Row label={t(settingsModelsMessages, "enableMemory")} description={t(settingsModelsMessages, "enableMemoryDescription")} badge={getFieldBadge("memory.enabled")}>
            <Toggle aria-label={t(settingsModelsMessages, "toggleSetting")} value={editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, enabled: !current.memory.enabled },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "autoCaptureSprint")} description={t(settingsModelsMessages, "autoCaptureSprintDescription")} badge={getFieldBadge("memory.autoCaptureSprint")}>
            <Toggle aria-label={t(settingsModelsMessages, "toggleSetting")} value={editableSettings.memory.autoCaptureSprint}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureSprint: !current.memory.autoCaptureSprint },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "autoCaptureAgent")} description={t(settingsModelsMessages, "autoCaptureAgentDescription")} badge={getFieldBadge("memory.autoCaptureAgent")}>
            <Toggle aria-label={t(settingsModelsMessages, "toggleSetting")} value={editableSettings.memory.autoCaptureAgent}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureAgent: !current.memory.autoCaptureAgent },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "autoPromote")} description={t(settingsModelsMessages, "autoPromoteDescription")} badge={getFieldBadge("memory.autoPromote")}>
            <Toggle aria-label={t(settingsModelsMessages, "toggleSetting")} value={editableSettings.memory.autoPromote}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoPromote: !current.memory.autoPromote },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "postSprintRemediation")} description={t(settingsModelsMessages, "postSprintRemediationDescription")} badge={getFieldBadge("memory.remediationMode")} last>
            <AvantgardeSelect
              aria-label={t(settingsModelsMessages, "postSprintRemediation")}
              value={editableSettings.memory.remediationMode}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => {
                updateEditableSettings((current) => ({
                  ...current,
                  memory: { ...current.memory, remediationMode: value as typeof editableSettings.memory.remediationMode },
                }));
              }}
              className="min-w-[12rem]"
              options={[
                { value: "off", label: t(settingsModelsMessages, "off") },
                { value: "deterministic", label: t(settingsModelsMessages, "deterministic") },
                { value: "ai", label: t(settingsModelsMessages, "aiRemediation") },
              ]}
            />
          </Row>
        </SectionCard>

        <SectionCard
          title={t(settingsModelsMessages, "longTermSchedule")}
          helpId="long-term-remediation-schedule"
          summary={t(settingsModelsMessages, "longTermScheduleSummary")}
          configureLabel={t(settingsModelsMessages, "configure")}
          watermark="SCH"
          badge={getBadge("memory")}
          icon={<CalendarClock strokeWidth={2.4} />}
          highlights={[
            { label: t(settingsModelsMessages, "cadence"), value: activeScope === "project" ? (scheduleCadence === "daily" ? t(settingsModelsMessages, "everyDay") : scheduleCadence === "weekly" ? t(settingsModelsMessages, "everyWeek") : t(settingsModelsMessages, "off")) : t(settingsModelsMessages, "projectOnly"), tone: scheduleCadence !== "off" ? "active" : "neutral" },
            { label: t(settingsModelsMessages, "mode"), value: scheduleMode === "ai" ? "AI" : t(settingsModelsMessages, "deterministic") },
            { label: t(settingsModelsMessages, "localTime"), value: scheduleTime },
          ]}
        >
          {activeScope !== "project" || !selectedProject ? (
            <NoticePanel title={t(settingsModelsMessages, "projectSchedule")} tone="neutral">
              {t(settingsModelsMessages, "projectScheduleDescription")}
            </NoticePanel>
          ) : (
            <>
              <Row label={t(settingsModelsMessages, "scheduleCadence")} description={t(settingsModelsMessages, "scheduleCadenceDescription")} badge={getFieldBadge("memory.remediationMode")}>
                <AvantgardeSelect
                  aria-label={t(settingsModelsMessages, "scheduleCadence")}
                  value={scheduleCadence}
                  disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled}
                  onChange={(value) => setScheduleCadence(value as MemoryRemediationScheduleCadence)}
                  className="min-w-[12rem]"
                  options={[
                    { value: "off", label: t(settingsModelsMessages, "off") },
                    { value: "daily", label: t(settingsModelsMessages, "everyDay") },
                    { value: "weekly", label: t(settingsModelsMessages, "everyWeek") },
                ]}
                />
              </Row>
              <Row label={t(settingsModelsMessages, "remediationMode")} description={t(settingsModelsMessages, "remediationModeDescription")} badge={getFieldBadge("memory.remediationMode")}>
                <AvantgardeSelect
                  aria-label={t(settingsModelsMessages, "remediationMode")}
                  value={scheduleMode}
                  disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled || scheduleCadence === "off"}
                  onChange={(value) => setScheduleMode(value as "deterministic" | "ai")}
                  className="min-w-[12rem]"
                  options={[
                    { value: "deterministic", label: t(settingsModelsMessages, "deterministic") },
                    { value: "ai", label: t(settingsModelsMessages, "aiRemediation") },
                ]}
                />
              </Row>
              <Row label={t(settingsModelsMessages, "runTime")} description={t(settingsModelsMessages, "runTimeDescription")} badge={getFieldBadge("memory.remediationMode")} last>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <input
                    type="time"
                    value={scheduleTime}
                    disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled || scheduleCadence === "off"}
                    onInput={(event) => setScheduleTime((event.currentTarget as HTMLInputElement).value || "03:00")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => void saveSchedule()}
                    disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled}
                    className="rounded-lg bg-signal-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-signal-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {scheduleSaving ? t(settingsModelsMessages, "saving") : t(settingsModelsMessages, "saveSchedule")}
                  </button>
                </div>
              </Row>
              {(scheduleMessage || scheduleError) && (
                <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${scheduleError ? "bg-status-red/10 text-status-red" : "bg-signal-500/10 text-signal-700 dark:text-signal-300"}`}>
                  {scheduleError || scheduleMessage}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          title={t(settingsModelsMessages, "limits")}
          helpId="limits"
          summary={t(settingsModelsMessages, "limitsSummary")}
          configureLabel={t(settingsModelsMessages, "configure")}
          watermark="CAP"
          badge={getBadge("memory")}
          icon={<Gauge strokeWidth={2.4} />}
          highlights={[
            { label: t(settingsModelsMessages, "sprintMemories"), value: t(settingsModelsMessages, "maximumValue", { count: formatNumber(editableSettings.memory.maxSprintMemories) }) },
            { label: t(settingsModelsMessages, "projectMemories"), value: t(settingsModelsMessages, "maximumValue", { count: formatNumber(editableSettings.memory.maxProjectMemories) }), tone: "active" },
            { label: t(settingsModelsMessages, "promotionScore"), value: formatNumber(editableSettings.memory.promotionThreshold, { minimumFractionDigits: 1, maximumFractionDigits: 2 }) },
          ]}
        >
          <Row label={t(settingsModelsMessages, "promotionThreshold")} description={t(settingsModelsMessages, "promotionThresholdDescription")} badge={getFieldBadge("memory.promotionThreshold")}>
            <NumberInput
              value={editableSettings.memory.promotionThreshold}
              min={0}
              max={1}
              step={0.05}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, promotionThreshold: value },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "maxSprintMemories")} description={t(settingsModelsMessages, "maxSprintMemoriesDescription")} badge={getFieldBadge("memory.maxSprintMemories")}>
            <NumberInput
              value={editableSettings.memory.maxSprintMemories}
              min={10}
              max={5000}
              step={10}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxSprintMemories: value },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "maxProjectMemories")} description={t(settingsModelsMessages, "maxProjectMemoriesDescription")} badge={getFieldBadge("memory.maxProjectMemories")}>
            <NumberInput
              value={editableSettings.memory.maxProjectMemories}
              min={10}
              max={10000}
              step={50}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxProjectMemories: value },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "mapEdges")} description={t(settingsModelsMessages, "mapEdgesDescription")} badge={getFieldBadge("memory.mapMaxEdgesPerNode")}>
            <NumberInput
              value={editableSettings.memory.mapMaxEdgesPerNode}
              min={1}
              max={20}
              step={1}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, mapMaxEdgesPerNode: value },
              }))}
            />
          </Row>
          <Row label={t(settingsModelsMessages, "maxRemediationPromotions")} description={t(settingsModelsMessages, "maxRemediationPromotionsDescription")} badge={getFieldBadge("memory.remediationMaxPromotions")} last>
            <NumberInput
              value={editableSettings.memory.remediationMaxPromotions}
              min={1}
              max={100}
              step={1}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, remediationMaxPromotions: value },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard
          title={t(settingsModelsMessages, "embeddingProvider")}
          helpId="embedding-provider"
          summary={t(settingsModelsMessages, "embeddingProviderSummary")}
          configureLabel={t(settingsModelsMessages, "configure")}
          watermark="EMB"
          badge={getBadge("memory")}
          icon={<Brain strokeWidth={2.4} />}
          highlights={[
            { label: t(settingsModelsMessages, "backend"), value: editableSettings.memory.embeddingProvider === "in_app" ? t(settingsModelsMessages, "localModel") : t(settingsModelsMessages, "externalApi"), tone: "active" },
            { label: t(settingsModelsMessages, "model"), value: editableSettings.memory.embeddingModel || t(settingsModelsMessages, "catalogDefault") },
            { label: t(settingsModelsMessages, "privacy"), value: editableSettings.memory.embeddingProvider === "in_app" ? t(settingsModelsMessages, "onDevice") : t(settingsModelsMessages, "external") },
          ]}
        >
          <Row label={t(settingsModelsMessages, "embeddingBackend")} description={t(settingsModelsMessages, "embeddingBackendDescription")} badge={getFieldBadge("memory.embeddingProvider")}>
            <AvantgardeSelect
              aria-label={t(settingsModelsMessages, "embeddingBackend")}
              value={editableSettings.memory.embeddingProvider}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => {
                updateEditableSettings((current) => ({
                  ...current,
                  memory: { ...current.memory, embeddingProvider: value as typeof editableSettings.memory.embeddingProvider },
                }));
              }}
              className="min-w-[12rem]"
              options={[
                { value: "in_app", label: t(settingsModelsMessages, "inAppModels") },
                { value: "external_api", label: t(settingsModelsMessages, "externalApi") },
              ]}
            />
          </Row>
          {editableSettings.memory.embeddingProvider === "external_api" && (
            <>
              <Row label={t(settingsModelsMessages, "embeddingApiUrl")} description={t(settingsModelsMessages, "embeddingApiUrlDescription")} badge={getFieldBadge("memory.externalEmbedding.baseUrl")}>
                <TextInput
                  value={editableSettings.memory.externalEmbedding.baseUrl}
                  disabled={!editableSettings.memory.enabled}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      externalEmbedding: { ...current.memory.externalEmbedding, baseUrl: value },
                    },
                  }))}
                />
              </Row>
              <Row label={t(settingsModelsMessages, "embeddingModel")} description={t(settingsModelsMessages, "embeddingModelDescription")} badge={getFieldBadge("memory.externalEmbedding.model")}>
                <TextInput
                  value={editableSettings.memory.externalEmbedding.model}
                  disabled={!editableSettings.memory.enabled}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      embeddingModel: value,
                      externalEmbedding: { ...current.memory.externalEmbedding, model: value },
                    },
                  }))}
                />
              </Row>
              <Row label={t(settingsModelsMessages, "embeddingApiKey")} description={t(settingsModelsMessages, "embeddingApiKeyDescription")} badge={getFieldBadge("memory.externalEmbedding.apiKey")} last>
                <SecretInput
                  value={editableSettings.memory.externalEmbedding.apiKey}
                  disabled={!editableSettings.memory.enabled}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      externalEmbedding: { ...current.memory.externalEmbedding, apiKey: value },
                    },
                  }))}
                  aria-label={t(settingsModelsMessages, "embeddingApiKey")}
                  mono
                />
              </Row>
            </>
          )}
        </SectionCard>

        <SectionCard
          title={t(settingsModelsMessages, "workerLearnings")}
          helpId="worker-learnings-instruction"
          summary={t(settingsModelsMessages, "workerLearningsSummary")}
          configureLabel={t(settingsModelsMessages, "configure")}
          watermark="LRN"
          badge={getBadge("memory")}
          icon={<BookOpen strokeWidth={2.4} />}
          highlights={[
            { label: t(settingsModelsMessages, "instruction"), value: editableSettings.memory.workerLearningsInstruction.trim() ? t(settingsModelsMessages, "customized") : t(settingsModelsMessages, "empty"), tone: editableSettings.memory.workerLearningsInstruction.trim() ? "active" : "warning" },
            { label: t(settingsModelsMessages, "length"), value: tp(settingsModelsMessages, "characters", editableSettings.memory.workerLearningsInstruction.length, { count: formatNumber(editableSettings.memory.workerLearningsInstruction.length) }) },
            { label: t(settingsModelsMessages, "usedWhen"), value: t(settingsModelsMessages, "autoCapture") },
          ]}
        >
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium leading-relaxed text-slate-400 mb-3">
              {t(settingsModelsMessages, "workerLearningsDescription")}
            </div>
            <TextAreaInput
              value={editableSettings.memory.workerLearningsInstruction}
              rows={16}
              placeholder={t(settingsModelsMessages, "workerLearningsPlaceholder")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, workerLearningsInstruction: value },
              }))}
            />
          </div>
        </SectionCard>

        <NoticePanel title={t(settingsModelsMessages, "embeddingModels")} tone="success">
          {t(settingsModelsMessages, "embeddingModelsDescription")}
        </NoticePanel>
      </div>
    );
  };

function toTimeInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "03:00";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function nextLocalOccurrenceIso(timeValue: string, cadence: Exclude<MemoryRemediationScheduleCadence, "off">): string {
  const [hoursRaw, minutesRaw] = timeValue.split(":");
  const hours = Math.max(0, Math.min(23, Number(hoursRaw) || 3));
  const minutes = Math.max(0, Math.min(59, Number(minutesRaw) || 0));
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + (cadence === "weekly" ? 7 : 1));
  }
  return next.toISOString();
}
