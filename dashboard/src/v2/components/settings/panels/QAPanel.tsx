import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle, NumberInput } from "../SettingsFormFields.js";
import { SectionCard, Row } from "./SharedPanelComponents.js";
import { ShieldCheck } from "lucide-preact";

// Taking the QA section from SettingsAgentsPanel.tsx
export const QAPanel: FunctionComponent<{
  settings: ProjectSettings["agents"]["qualityAssurance"];
  update: (patch: Partial<ProjectSettings["agents"]["qualityAssurance"]>) => void;
  getBadge: (path: string) => string | undefined;
  sectionBadge: string | undefined;
  presetOptions: Array<{ value: string; label: string }>;
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
          <Toggle
            value={settings.enabled}
            onChange={(value) => update({ enabled: value })}
          />
        </Row>

        {settings.enabled ? (
          <>
            <Row
              label="Task QA max runs"
              description="Default is 1. Increase this only when you want QA to review fixes made after the first QA pass."
              badge={getBadge("agents.qualityAssurance.maxTaskReviewRuns")}
            >
              <NumberInput
                value={settings.maxTaskReviewRuns}
                min={1}
                max={10}
                onChange={(value) => update({
                  maxTaskReviewRuns: Number.isFinite(value) ? Math.min(10, Math.max(1, Math.floor(value))) : 1,
                })}
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
                <Toggle
                  value={settings.taskCompletion.enabled}
                  onChange={(value) => update({
                    taskCompletion: {
                      ...settings.taskCompletion,
                      enabled: value,
                    },
                  })}
                />
                <SelectInput
                  value={settings.taskCompletion.agentPresetId || ""}
                  onChange={(value) => update({
                    taskCompletion: {
                      ...settings.taskCompletion,
                      agentPresetId: value || null,
                    },
                  })}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  aria-label="Task completion QA agent preset"
                />
              </div>
            </Row>

            <Row
              label="Review before sprint completion"
              description="Blocks final sprint completion when QA finds integration problems and can route the fix back into the most relevant task."
              badge={getBadge("agents.qualityAssurance.sprintCompletion.enabled")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle
                  value={settings.sprintCompletion.enabled}
                  onChange={(value) => update({
                    sprintCompletion: {
                      ...settings.sprintCompletion,
                      enabled: value,
                    },
                  })}
                />
                <SelectInput
                  value={settings.sprintCompletion.agentPresetId || ""}
                  onChange={(value) => update({
                    sprintCompletion: {
                      ...settings.sprintCompletion,
                      agentPresetId: value || null,
                    },
                  })}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  aria-label="Sprint completion QA agent preset"
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
                <Toggle
                  value={settings.completedTaskWithoutPr.enabled}
                  onChange={(value) => update({
                    completedTaskWithoutPr: {
                      ...settings.completedTaskWithoutPr,
                      enabled: value,
                    },
                  })}
                />
                <SelectInput
                  value={settings.completedTaskWithoutPr.agentPresetId || ""}
                  onChange={(value) => update({
                    completedTaskWithoutPr: {
                      ...settings.completedTaskWithoutPr,
                      agentPresetId: value || null,
                    },
                  })}
                  options={presetOptions}
                  disabled={selectorsDisabled}
                  aria-label="No PR QA agent preset"
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
