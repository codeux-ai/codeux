import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, TextInput, TextAreaInput } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { BookOpen, Brain, CalendarClock, Gauge } from "lucide-preact";
import { fetchMemoryRemediationSchedule, saveMemoryRemediationSchedule } from "../../../lib/scheduler-api.js";
import type { MemoryRemediationScheduleCadence } from "../../../types.js";

  export const SettingsMemoryPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
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
      setScheduleMessage(response.cadence === "off" ? "Long-term remediation schedule paused." : "Long-term remediation schedule saved.");
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
      <div className="flex flex-col gap-5">
        <SectionCard title="Memory System" watermark="MEM" badge={getBadge("memory")} icon={<Brain strokeWidth={2.4} />}>
          <Row label="Enable memory" description="Turn on the memory system for automatic capture, storage, and semantic search of sprint knowledge." badge={getFieldBadge("memory.enabled")}>
            <Toggle aria-label="Toggle setting"               value={editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, enabled: !current.memory.enabled },
              }))}
            />
          </Row>
          <Row label="Auto-capture sprint events" description="Automatically create memories when tasks complete, fail, or encounter CI issues during sprint execution." badge={getFieldBadge("memory.autoCaptureSprint")}>
            <Toggle aria-label="Toggle setting"               value={editableSettings.memory.autoCaptureSprint}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureSprint: !current.memory.autoCaptureSprint },
              }))}
            />
          </Row>
          <Row label="Auto-capture agent events" description="Capture memories from notable agent interactions such as retries and clarifications." badge={getFieldBadge("memory.autoCaptureAgent")}>
            <Toggle aria-label="Toggle setting"               value={editableSettings.memory.autoCaptureAgent}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureAgent: !current.memory.autoCaptureAgent },
              }))}
            />
          </Row>
          <Row label="Auto-promote to project scope" description="Automatically promote recurring or high-strength sprint memories to long-term project knowledge when a sprint completes." badge={getFieldBadge("memory.autoPromote")}>
            <Toggle aria-label="Toggle setting"               value={editableSettings.memory.autoPromote}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoPromote: !current.memory.autoPromote },
              }))}
            />
          </Row>
          <Row label="Post-sprint remediation" description="Curate sprint memories after completion. AI mode uses the Remediation route and guardrail." badge={getFieldBadge("memory.remediationMode")} last>
            <select
              value={editableSettings.memory.remediationMode}
              disabled={!editableSettings.memory.enabled}
              onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value as typeof editableSettings.memory.remediationMode;
                updateEditableSettings((current) => ({
                  ...current,
                  memory: { ...current.memory, remediationMode: value },
                }));
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
            >
              <option value="off">Off</option>
              <option value="deterministic">Deterministic</option>
              <option value="ai">AI remediation</option>
            </select>
          </Row>
        </SectionCard>

        <SectionCard title="Long-Term Remediation Schedule" watermark="SCH" badge={getBadge("memory")} icon={<CalendarClock strokeWidth={2.4} />}>
          {activeScope !== "project" || !selectedProject ? (
            <NoticePanel title="Project schedule" tone="neutral">
              Long-term memory remediation schedules are project-specific. Select a project scope to create a recurring cleanup and claim-maintenance job.
            </NoticePanel>
          ) : (
            <>
              <Row label="Schedule cadence" description="Create or update the scheduler entry that runs project-scoped long-term memory remediation." badge={getFieldBadge("memory.remediationMode")}>
                <select
                  value={scheduleCadence}
                  disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled}
                  onChange={(event) => setScheduleCadence((event.currentTarget as HTMLSelectElement).value as MemoryRemediationScheduleCadence)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
                >
                  <option value="off">Off</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </Row>
              <Row label="Remediation mode" description="Deterministic mode applies safe cleanup heuristics. AI mode routes candidates through the Remediation provider route." badge={getFieldBadge("memory.remediationMode")}>
                <select
                  value={scheduleMode}
                  disabled={scheduleLoading || scheduleSaving || !editableSettings.memory.enabled || scheduleCadence === "off"}
                  onChange={(event) => setScheduleMode((event.currentTarget as HTMLSelectElement).value as "deterministic" | "ai")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
                >
                  <option value="deterministic">Deterministic</option>
                  <option value="ai">AI remediation</option>
                </select>
              </Row>
              <Row label="Run time" description="The next scheduler occurrence is calculated in your local timezone." badge={getFieldBadge("memory.remediationMode")} last>
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
                    className="rounded-lg bg-signal-500 px-3 py-2 text-sm font-black text-white shadow-sm transition hover:bg-signal-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {scheduleSaving ? "Saving..." : "Save schedule"}
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

        <SectionCard title="Limits" watermark="CAP" badge={getBadge("memory")} icon={<Gauge strokeWidth={2.4} />}>
          <Row label="Promotion threshold" description="Minimum score (0.0–1.0) a sprint memory needs to be auto-promoted to project scope." badge={getFieldBadge("memory.promotionThreshold")}>
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
          <Row label="Max sprint memories" description="Maximum number of memories retained per sprint. Lowest-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxSprintMemories")}>
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
          <Row label="Max project memories" description="Maximum number of long-term project-scoped memories. Oldest low-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxProjectMemories")}>
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
          <Row label="Map edges per node" description="Maximum number of similarity connections per memory node on the neural map. Lower values produce a cleaner graph, higher values reveal more relationships." badge={getFieldBadge("memory.mapMaxEdgesPerNode")}>
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
          <Row label="Max remediation promotions" description="Upper bound for memories promoted during one post-sprint remediation run." badge={getFieldBadge("memory.remediationMaxPromotions")} last>
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

        <SectionCard title="Embedding Provider" watermark="EMB" badge={getBadge("memory")} icon={<Brain strokeWidth={2.4} />}>
          <Row label="Embedding backend" description="Use downloaded in-app ONNX models or an external OpenAI-compatible embeddings API." badge={getFieldBadge("memory.embeddingProvider")}>
            <select
              value={editableSettings.memory.embeddingProvider}
              disabled={!editableSettings.memory.enabled}
              onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value as typeof editableSettings.memory.embeddingProvider;
                updateEditableSettings((current) => ({
                  ...current,
                  memory: { ...current.memory, embeddingProvider: value },
                }));
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
            >
              <option value="in_app">In-app models</option>
              <option value="external_api">External API</option>
            </select>
          </Row>
          {editableSettings.memory.embeddingProvider === "external_api" && (
            <>
              <Row label="Embedding API URL" description="OpenAI-compatible embeddings endpoint." badge={getFieldBadge("memory.externalEmbedding.baseUrl")}>
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
              <Row label="Embedding model" description="Model id sent to the external embeddings endpoint." badge={getFieldBadge("memory.externalEmbedding.model")}>
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
              <Row label="Embedding API key" description="Bearer token for the external embedding provider." badge={getFieldBadge("memory.externalEmbedding.apiKey")} last>
                <input
                  type="password"
                  value={editableSettings.memory.externalEmbedding.apiKey}
                  disabled={!editableSettings.memory.enabled}
                  onInput={(event) => updateEditableSettings((current) => ({
                    ...current,
                    memory: {
                      ...current.memory,
                      externalEmbedding: { ...current.memory.externalEmbedding, apiKey: (event.currentTarget as HTMLInputElement).value },
                    },
                  }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-void-900 dark:text-slate-100"
                />
              </Row>
            </>
          )}
        </SectionCard>

        <SectionCard title="Worker Learnings Instruction" watermark="LRN" badge={getBadge("memory")} icon={<BookOpen strokeWidth={2.4} />}>
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium leading-relaxed text-slate-400 mb-3">
              This instruction is appended to every worker task prompt when auto-capture is enabled. It tells the AI provider what to observe and record in a temporary learnings file that gets processed into sprint memories.
            </div>
            <TextAreaInput
              value={editableSettings.memory.workerLearningsInstruction}
              rows={16}
              placeholder="Enter the instruction that tells workers what to capture..."
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, workerLearningsInstruction: value },
              }))}
            />
          </div>
        </SectionCard>

        <NoticePanel title="Embedding models" tone="success">
          Download and manage embedding models from the Memory page. Once a model is active, new memories are automatically embedded for semantic search. The memory system works without a model — search falls back to text matching.
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
