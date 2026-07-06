import type { ComponentChildren, FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle, NumberInput } from "../SettingsFormFields.js";
import { SectionCard, Row } from "./SharedPanelComponents.js";
import { ShieldCheck } from "lucide-preact";
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
}> = ({ settings, update, getBadge, sectionBadge, presetOptions, selectorsDisabled, selectedProjectName, activeScope }) => {
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
      </SectionCard>
  );
};
