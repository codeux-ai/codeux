import type { ComponentChildren, FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle, NumberInput } from "../SettingsFormFields.js";
import { SectionCard, Row } from "./SharedPanelComponents.js";
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

const renderOptionIcon = (icon: QaPresetOption["icon"]): ComponentChildren => (
  typeof icon === "function" ? icon() : icon
);

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
  const selectedIds = new Set(value);
  const selectedCount = value.length;
  const fallbackText = disabled
    ? "Built-in QA agent fallback is active. Select a project to choose custom QA agents."
    : selectedCount === 0
      ? "Built-in QA agent fallback is active."
      : `${selectedCount} custom QA ${selectedCount === 1 ? "agent" : "agents"} selected.`;

  const toggleId = (id: string, checked: boolean): void => {
    if (checked) {
      onChange([...value, id]);
      return;
    }
    onChange(value.filter((selectedId) => selectedId !== id));
  };

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 flex-1 rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]"
    >
      <legend className="sr-only">{label}</legend>
      <div className="mb-2 text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400" role="status">
        {fallbackText}
      </div>
      {options.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]">
          {options.map((option) => {
            const checked = selectedIds.has(option.value);
            return (
              <label
                key={option.value}
                className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-[0.85rem] border px-3 py-2 text-sm font-semibold transition-all ${
                  checked
                    ? "border-signal-500/35 bg-signal-500/[0.1] text-signal-800 dark:border-signal-400/35 dark:bg-signal-400/[0.12] dark:text-signal-100"
                    : "border-black/[0.06] bg-black/[0.02] text-slate-700 hover:border-black/[0.12] hover:bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.07]"
                } has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => toggleId(option.value, event.currentTarget.checked)}
                  className="h-4 w-4 shrink-0 rounded border-black/20 text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/20 dark:bg-white/[0.08] dark:focus-visible:ring-offset-void-900"
                />
                {option.icon ? (
                  <span className="shrink-0" aria-hidden="true">{renderOptionIcon(option.icon)}</span>
                ) : null}
                <span className="min-w-0 break-words">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[0.85rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-3 py-2 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
          No custom QA agents are available for this project.
        </div>
      )}
    </fieldset>
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
  return (
      <SectionCard title="Quality Assurance" watermark="QA" badge={sectionBadge} icon={<ShieldCheck strokeWidth={2.4} />}>
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
            <Row
              label="Task QA max runs"
              description="How many QA review cycles a single task gets before the exhaustion policy applies. Default is 3."
              badge={getBadge("agents.qualityAssurance.maxTaskReviewRuns")}
            >
              <NumberInput
                value={settings.maxTaskReviewRuns}
                min={1}
                max={20}
                onChange={(value) => update({
                  maxTaskReviewRuns: Number.isFinite(value) ? Math.min(20, Math.max(1, Math.floor(value))) : 1,
                })}
              />
            </Row>

            <Row
              label="Sprint QA max runs"
              description="How many sprint-completion QA review cycles a sprint gets before its budget is spent. Default is 3."
              badge={getBadge("agents.qualityAssurance.maxSprintReviewRuns")}
            >
              <NumberInput
                value={settings.maxSprintReviewRuns}
                min={1}
                max={20}
                onChange={(value) => update({
                  maxSprintReviewRuns: Number.isFinite(value) ? Math.min(20, Math.max(1, Math.floor(value))) : 1,
                })}
              />
            </Row>

            <Row
              label="When QA max runs is exhausted"
              description="What to do with a code-complete task whose QA budget is spent without a pass. Finish is the default and marks it complete despite no QA pass; Fail marks it failed; Escalate holds it for a human."
              badge={getBadge("agents.qualityAssurance.exhaustionPolicy")}
            >
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
            </Row>

            {selectedProjectName && activeScope !== "project" ? (
              <div className="rounded-[1.15rem] border border-signal-500/18 bg-signal-500/[0.08] px-4 py-3 text-xs leading-relaxed text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
                QA settings are project-local. Changing any QA control here switches the panel to Project scope for {selectedProjectName}.
              </div>
            ) : null}

            <Row
              label="Review every completed task"
              description="Runs once after a task completes, then only repeats for QA-driven follow-up loops until the max run count is reached."
              badge={getBadge("agents.qualityAssurance.taskCompletion.enabled")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle aria-label="Toggle setting"                   value={settings.taskCompletion.enabled}
                  onChange={(value) => update({
                    taskCompletion: {
                      ...settings.taskCompletion,
                      enabled: value,
                    },
                  })}
                />
                <QaAgentPresetChecklist
                  label="Task completion QA agent presets"
                  value={normalizeAgentPresetIds(settings.taskCompletion)}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  onChange={(agentPresetIds) => update({
                    taskCompletion: {
                      ...withAgentPresetIds(settings.taskCompletion, agentPresetIds),
                    },
                  })}
                />
              </div>
            </Row>

            <Row
              label="Review before sprint completion"
              description="Blocks final sprint completion when QA finds integration problems and can route the fix back into the most relevant task."
              badge={getBadge("agents.qualityAssurance.sprintCompletion.enabled")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle aria-label="Toggle setting"                   value={settings.sprintCompletion.enabled}
                  onChange={(value) => update({
                    sprintCompletion: {
                      ...settings.sprintCompletion,
                      enabled: value,
                    },
                  })}
                />
                <QaAgentPresetChecklist
                  label="Sprint completion QA agent presets"
                  value={normalizeAgentPresetIds(settings.sprintCompletion)}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  onChange={(agentPresetIds) => update({
                    sprintCompletion: {
                      ...withAgentPresetIds(settings.sprintCompletion, agentPresetIds),
                    },
                  })}
                />
              </div>
            </Row>

            <Row
              label="Review completed tasks without a PR"
              description="Lets QA investigate whether a missing PR is valid or whether the task still needs branch and PR hygiene before it can stay complete."
              badge={getBadge("agents.qualityAssurance.completedTaskWithoutPr.enabled")}
              last
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle aria-label="Toggle setting"                   value={settings.completedTaskWithoutPr.enabled}
                  onChange={(value) => update({
                    completedTaskWithoutPr: {
                      ...settings.completedTaskWithoutPr,
                      enabled: value,
                    },
                  })}
                />
                <QaAgentPresetChecklist
                  label="No PR QA agent presets"
                  value={normalizeAgentPresetIds(settings.completedTaskWithoutPr)}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  onChange={(agentPresetIds) => update({
                    completedTaskWithoutPr: {
                      ...withAgentPresetIds(settings.completedTaskWithoutPr, agentPresetIds),
                    },
                  })}
                />
              </div>
            </Row>

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
