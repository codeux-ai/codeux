import type { ComponentChildren, FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle, NumberInput } from "../SettingsFormFields.js";
import { OptionCardChoiceGroup, SectionCard, Row, ToggleLinkedControlRow } from "./SharedPanelComponents.js";
import { Plus, ShieldCheck, Trash2 } from "lucide-preact";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";

type QaPresetOption = {
  value: string;
  label: string;
  icon?: ComponentChildren | (() => ComponentChildren);
};

type QaTriggerSettings = ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"];

const normalizeAgentPresetIds = (trigger: QaTriggerSettings): string[] => {
  const sourceIds = Array.isArray(trigger.agentPresetIds)
    ? trigger.agentPresetIds
    : trigger.agentPresetId
      ? [trigger.agentPresetId]
      : [];
  return [...new Set(sourceIds.map((id) => id.trim()).filter(Boolean))];
};

const withAgentPresetIds = (trigger: QaTriggerSettings, nextIds: string[]): QaTriggerSettings => {
  const agentPresetIds = [...new Set(nextIds.map((id) => id.trim()).filter(Boolean))];
  return {
    ...trigger,
    agentPresetIds,
    agentPresetId: agentPresetIds[0] ?? null,
  };
};

type ReflectionLoopSettings = ProjectSettings["agents"]["selfReflection"]["planning"];
type ReflectionCriterion = ReflectionLoopSettings["criteria"][number];

const clampThreshold = (value: number): number => (
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
);

const makeCriterionId = (): string => `criterion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const SelfReflectionControls: FunctionComponent<{
  title: string;
  description: string;
  settings: ReflectionLoopSettings;
  update: (settings: ReflectionLoopSettings) => void;
  getBadge: (path: string) => string | undefined;
  basePath: string;
  last?: boolean;
}> = ({ title, description, settings, update, getBadge, basePath, last }) => {
  const updateCriterion = (criterionId: string, patch: Partial<ReflectionCriterion>): void => {
    update({
      ...settings,
      criteria: settings.criteria.map((criterion) => (
        criterion.id === criterionId ? { ...criterion, ...patch } : criterion
      )),
    });
  };

  const removeCriterion = (criterionId: string): void => {
    update({
      ...settings,
      criteria: settings.criteria.filter((criterion) => criterion.id !== criterionId),
    });
  };

  const addCriterion = (): void => {
    update({
      ...settings,
      criteria: [
        ...settings.criteria,
        {
          id: makeCriterionId(),
          label: "New criterion",
          prompt: "",
          threshold: 0.8,
        },
      ],
    });
  };

  return (
    <Row label={title} description={description} badge={getBadge(`${basePath}.enabled`)} last={last}>
      <div className="flex w-full min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            aria-label={`Enable ${title}`}
            value={settings.enabled}
            onChange={(value) => update({ ...settings, enabled: value })}
          />
          <span
            role="status"
            className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
              settings.enabled
                ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-200"
                : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
            }`}
          >
            {settings.enabled ? "Opted in" : "Off by default"}
          </span>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Max improvement attempts
          </span>
          <NumberInput
            aria-label={`${title} max improvement attempts`}
            value={settings.maxImprovementAttempts}
            min={0}
            max={5}
            onChange={(value) => update({
              ...settings,
              maxImprovementAttempts: Number.isFinite(value) ? Math.min(5, Math.max(0, Math.floor(value))) : 0,
            })}
          />
        </label>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Criteria rows
            </div>
            <button
              type="button"
              onClick={addCriterion}
              className="inline-flex items-center gap-2 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 transition-colors hover:bg-signal-500/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-signal-200"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Add criterion
            </button>
          </div>

          {settings.criteria.length === 0 ? (
            <div className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
              No rating criteria are configured. Add a row before enabling self-reflection.
            </div>
          ) : (
            <div className="grid gap-3">
              {settings.criteria.map((criterion, index) => {
                const labelId = `${basePath}-${criterion.id}-label`;
                const promptId = `${basePath}-${criterion.id}-prompt`;
                const thresholdId = `${basePath}-${criterion.id}-threshold`;
                return (
                  <div
                    key={criterion.id}
                    className="grid gap-3 rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04] lg:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.4fr)_120px_auto]"
                  >
                    <label className="flex min-w-0 flex-col gap-1.5" htmlFor={labelId}>
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        Label
                      </span>
                      <input
                        id={labelId}
                        type="text"
                        value={criterion.label}
                        onInput={(event) => updateCriterion(criterion.id, { label: event.currentTarget.value })}
                        className="rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-100"
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1.5" htmlFor={promptId}>
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        Rating prompt
                      </span>
                      <textarea
                        id={promptId}
                        value={criterion.prompt}
                        rows={2}
                        onInput={(event) => updateCriterion(criterion.id, { prompt: event.currentTarget.value })}
                        className="min-h-[4.5rem] resize-y rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-100"
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1.5" htmlFor={thresholdId}>
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        Threshold
                      </span>
                      <input
                        id={thresholdId}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={criterion.threshold}
                        aria-label={`${criterion.label || `Criterion ${index + 1}`} threshold`}
                        onInput={(event) => updateCriterion(criterion.id, { threshold: clampThreshold(Number(event.currentTarget.value)) })}
                        className="rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-100"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeCriterion(criterion.id)}
                        aria-label={`Remove ${criterion.label || `criterion ${index + 1}`}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-status-red/20 bg-status-red/[0.06] text-status-red transition-colors hover:bg-status-red/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Row>
  );
};

const QaAgentPresetChecklist: FunctionComponent<{
  label: string;
  value: string[];
  options: QaPresetOption[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}> = ({ label, value, options, disabled, onChange }) => {
  const selectedCount = value.length;
  const disabledReason = "Select a project to choose custom QA agents. Built-in QA routing remains available.";
  const fallbackText = disabled
    ? "Built-in QA fallback active. Select a project to choose custom QA agents."
    : selectedCount === 0
      ? "Built-in QA fallback active."
      : `${selectedCount} custom QA ${selectedCount === 1 ? "agent" : "agents"} selected.`;
  const optionCards = options.map((option) => ({
    ...option,
    description: "Use this project agent for this QA trigger.",
    disabled,
    disabledReason: disabled ? disabledReason : undefined,
  }));

  return (
    <div className="flex min-w-0 w-full flex-col gap-2">
      {options.length > 0 ? (
        <OptionCardChoiceGroup
          selectionMode="multiple"
          value={value}
          onChange={onChange}
          options={optionCards}
          aria-label={label}
          selectedSummaryLabel={fallbackText}
          helperText="Leave empty to use the built-in QA fallback for this trigger."
        />
      ) : (
        <div className="rounded-[0.85rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-3 py-2 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
          {disabled ? "Select a project to choose custom QA agents. Built-in QA routing remains available." : "No custom QA agents are available for this project. Built-in QA routing remains available."}
        </div>
      )}
    </div>
  );
};

// Shared QA section rendered by the settings panels that own QA configuration.
export const QAPanel: FunctionComponent<{
  settings: ProjectSettings["agents"]["qualityAssurance"];
  update: (patch: Partial<ProjectSettings["agents"]["qualityAssurance"]>) => void;
  getBadge: (path: string) => string | undefined;
  sectionBadge: string | undefined;
  presetOptions: QaPresetOption[];
  selectorsDisabled: boolean;
  selectedProjectName?: string;
  activeScope?: string;
  selfReflection?: ProjectSettings["agents"]["selfReflection"]["qualityAssurance"];
  updateSelfReflection?: (settings: ProjectSettings["agents"]["selfReflection"]["qualityAssurance"]) => void;
}> = ({ settings, update, getBadge, sectionBadge, presetOptions, selectorsDisabled, selectedProjectName, activeScope, selfReflection, updateSelfReflection }) => {
  const triggerRows = [
    {
      key: "taskCompletion" as const,
      label: "Review every completed task",
      description: "Runs once after a task completes, then only repeats for QA-driven follow-up loops until the task max run count is reached.",
      presetLabel: "Task completion QA agent presets",
      badgePath: "agents.qualityAssurance.taskCompletion.enabled",
    },
    {
      key: "sprintCompletion" as const,
      label: "Review before sprint completion",
      description: "Blocks final sprint completion when QA finds integration problems and can route the fix back into the most relevant task.",
      presetLabel: "Sprint completion QA agent presets",
      badgePath: "agents.qualityAssurance.sprintCompletion.enabled",
    },
    {
      key: "completedTaskWithoutPr" as const,
      label: "Review completed tasks without a PR",
      description: "Checks whether a missing PR is valid or whether the task still needs branch and PR hygiene before it can stay complete.",
      presetLabel: "Completed task without PR QA agent presets",
      badgePath: "agents.qualityAssurance.completedTaskWithoutPr.enabled",
    },
  ];

  return (
      <SectionCard
        title="Quality Assurance"
        watermark="QA"
        badge={sectionBadge}
        icon={<ShieldCheck strokeWidth={2.4} />}
        highlights={[
          { label: "QA agent", value: settings.enabled ? "Enabled" : "Off", tone: settings.enabled ? "active" : "warning" },
          { label: "Review triggers", value: `${triggerRows.filter((trigger) => settings[trigger.key].enabled).length} of ${triggerRows.length}` },
          { label: "Self-reflection", value: selfReflection?.enabled ? "Enabled" : "Off" },
        ]}
      >
        <Row
          label="Enable QA agent"
          description="Runs a senior QA pass after completion events, using full sprint context and continuing the current task session when fixes are required."
          badge={getBadge("agents.qualityAssurance.enabled")}
        >
          <Toggle aria-label="Toggle setting"             value={settings.enabled}
            onChange={(value) => update({ enabled: value })}
          />
        </Row>

        {settings.enabled ? (
          <>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Task QA max runs</div>
                      <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">Initial task review plus follow-up checks. Default is 3.</div>
                    </div>
                    {getBadge("agents.qualityAssurance.maxTaskReviewRuns") ? (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                        {getBadge("agents.qualityAssurance.maxTaskReviewRuns")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    <NumberInput
                      value={settings.maxTaskReviewRuns}
                      min={1}
                      max={20}
                      aria-label="Task QA max runs"
                      onChange={(value) => update({
                        maxTaskReviewRuns: Number.isFinite(value) ? Math.min(20, Math.max(1, Math.floor(value))) : 1,
                      })}
                    />
                  </div>
                </div>

                <div className="rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sprint QA max runs</div>
                      <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">Initial sprint review plus sprint-level follow-up checks. Default is 3.</div>
                    </div>
                    {getBadge("agents.qualityAssurance.maxSprintReviewRuns") ? (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                        {getBadge("agents.qualityAssurance.maxSprintReviewRuns")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    <NumberInput
                      value={settings.maxSprintReviewRuns}
                      min={1}
                      max={20}
                      aria-label="Sprint QA max runs"
                      onChange={(value) => update({
                        maxSprintReviewRuns: Number.isFinite(value) ? Math.min(20, Math.max(1, Math.floor(value))) : 1,
                      })}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">When QA max runs is exhausted</div>
                    <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      Finish marks the task complete despite no QA pass; Fail marks it failed; Escalate holds it for a human.
                    </div>
                  </div>
                  {getBadge("agents.qualityAssurance.exhaustionPolicy") ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                      {getBadge("agents.qualityAssurance.exhaustionPolicy")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3">
                  <SelectInput
                    value={settings.exhaustionPolicy}
                    onChange={(value) => update({
                      exhaustionPolicy: (value === "FAIL_TASK" || value === "FINISH_TASK" || value === "ESCALATE_TO_HUMAN")
                        ? value
                        : DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.exhaustionPolicy,
                    })}
                    options={[
                      { value: "FINISH_TASK", label: "Finish task" },
                      { value: "FAIL_TASK", label: "Fail task" },
                      { value: "ESCALATE_TO_HUMAN", label: "Escalate to human" },
                    ]}
                    aria-label="QA exhaustion policy"
                  />
                </div>
              </div>
            </div>

            {selectedProjectName && activeScope !== "project" ? (
              <div className="rounded-[1.15rem] border border-signal-500/18 bg-signal-500/[0.08] px-4 py-3 text-xs leading-relaxed text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
                QA settings are project-local. Changing any QA control here switches the panel to Project scope for {selectedProjectName}.
              </div>
            ) : null}

            <div className="grid gap-3">
              {triggerRows.map((row) => (
                <ToggleLinkedControlRow
                  key={row.key}
                  enabled={settings[row.key].enabled}
                  onEnabledChange={(value) => update({
                    [row.key]: {
                      ...settings[row.key],
                      enabled: value,
                    },
                  })}
                  toggleLabel={row.label}
                  description={row.description}
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    {getBadge(row.badgePath) ? (
                      <span className="w-fit rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                        {getBadge(row.badgePath)}
                      </span>
                    ) : null}
                    <QaAgentPresetChecklist
                      label={row.presetLabel}
                      value={normalizeAgentPresetIds(settings[row.key])}
                      options={presetOptions}
                      disabled={selectorsDisabled}
                      onChange={(agentPresetIds) => update({
                        [row.key]: {
                          ...withAgentPresetIds(settings[row.key], agentPresetIds),
                        },
                      })}
                    />
                  </div>
                </ToggleLinkedControlRow>
              ))}
            </div>

            {selectorsDisabled ? (
              <div className="rounded-[1.15rem] border border-black/[0.05] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-slate-400">
                Select a project to choose a custom QA agent. Built-in QA routing remains available without a project-specific preset.
              </div>
            ) : null}

          </>
        ) : (
          <div className="rounded-[1.15rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
            QA is disabled. Enable it to review completed tasks, gate sprint completion, and inspect completed tasks that do not yet have a PR.
          </div>
        )}

        {selfReflection && updateSelfReflection ? (
          <SelfReflectionControls
            title="QA self-reflection"
            description="Optionally rates QA review output against editable criteria and can retry improvement before the review is accepted."
            settings={selfReflection}
            update={updateSelfReflection}
            getBadge={getBadge}
            basePath="agents.selfReflection.qualityAssurance"
            last
          />
        ) : null}
      </SectionCard>
  );
};
