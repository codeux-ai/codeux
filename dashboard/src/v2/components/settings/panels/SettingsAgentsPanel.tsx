import type { FunctionComponent } from "preact";
import type { SettingsPageState, AgentInstructionTemplateId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { Row, Toggle, TextAreaInput, SelectInput, NumberInput } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

export const SettingsAgentsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    selectedAgentTemplate,
    setSelectedAgentTemplate,
    agentInstructionTemplateOptions,
    projectAgentPresetOptions,
    updateProject,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  if (!editableSettings) {
    return null;
  }

  const selectedTemplateConfig = agentInstructionTemplateOptions.find((option) => option.value === selectedAgentTemplate)
    ?? agentInstructionTemplateOptions[0]!;
  const selectedTemplateValue = editableSettings.agents.instructionTemplates[selectedAgentTemplate] || "";
  const qaSettings = projectSettings?.agents.qualityAssurance ?? editableSettings.agents.qualityAssurance;
  const qaPresetOptions = [{ value: "", label: "Built-in QA agent" }, ...projectAgentPresetOptions];
  const qaPresetSelectorsDisabled = !selectedProject || !projectSettings;
  const qaSectionBadge = selectedProject
    ? getBadgeHelper("project", projectSources, "agents", "agents.qualityAssurance")
    : getBadge("agents", "agents.qualityAssurance");
  const qaFieldBadge = (path: string) => (
    selectedProject
      ? getFieldBadgeHelper("project", projectSources, path)
      : getFieldBadge(path)
  );

  const updateQaSettings = (recipe: (current: typeof qaSettings) => typeof qaSettings) => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          qualityAssurance: recipe(current.agents.qualityAssurance),
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        qualityAssurance: recipe(current.agents.qualityAssurance),
      },
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Project Markdown Mirror" watermark="AGT" badge={getBadge("agents")}>
        <Row
          label="Save agent markdown to project directory"
          description="When enabled, dashboard edits write a companion markdown file under `.sprint-os/agents` for the selected project. Default and home agent files are never modified."
          badge={getFieldBadge("agents.saveToProjectDirectory")}
        >
          <Toggle
            value={editableSettings.agents.saveToProjectDirectory}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              agents: {
                ...current.agents,
                saveToProjectDirectory: !current.agents.saveToProjectDirectory,
              },
            }))}
          />
        </Row>
        <Row label="Mirror directory" description="Dashboard-authored markdown companions live alongside other project-local Sprint OS files." last>
          <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
            .sprint-os/agents
          </div>
        </Row>
      </SectionCard>

      <SectionCard title="Quality Assurance" watermark="QA" badge={qaSectionBadge}>
        <Row
          label="Enable QA agent"
          description="Runs a senior QA pass after completion events, using full sprint context and continuing the current task session when fixes are required."
          badge={qaFieldBadge("agents.qualityAssurance.enabled")}
        >
          <Toggle
            value={qaSettings.enabled}
            onChange={(value) => updateQaSettings((current) => ({
              ...current,
              enabled: value,
            }))}
          />
        </Row>

        {qaSettings.enabled ? (
          <>
            <Row
              label="Task QA max runs"
              description="Default is 1. Increase this only when you want QA to review fixes made after the first QA pass."
              badge={qaFieldBadge("agents.qualityAssurance.maxTaskReviewRuns")}
            >
              <NumberInput
                value={qaSettings.maxTaskReviewRuns}
                min={1}
                max={10}
                onChange={(value) => updateQaSettings((current) => ({
                  ...current,
                  maxTaskReviewRuns: Number.isFinite(value) ? Math.min(10, Math.max(1, Math.floor(value))) : 1,
                }))}
              />
            </Row>

            {selectedProject && activeScope !== "project" ? (
              <div className="rounded-[1.15rem] border border-signal-500/18 bg-signal-500/[0.08] px-4 py-3 text-xs leading-relaxed text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
                QA settings are project-local. Changing any QA control here switches the panel to Project scope for {selectedProject.name}.
              </div>
            ) : null}

            <Row
              label="Review every completed task"
              description="Runs once after a task completes, then only repeats for QA-driven follow-up loops until the max run count is reached."
              badge={qaFieldBadge("agents.qualityAssurance.taskCompletion.enabled")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle
                  value={qaSettings.taskCompletion.enabled}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    taskCompletion: {
                      ...current.taskCompletion,
                      enabled: value,
                    },
                  }))}
                />
                <SelectInput
                  value={qaSettings.taskCompletion.agentPresetId || ""}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    taskCompletion: {
                      ...current.taskCompletion,
                      agentPresetId: value || null,
                    },
                  }))}
                  options={qaPresetOptions}
                  disabled={qaPresetSelectorsDisabled}
                  aria-label="Task completion QA agent preset"
                />
              </div>
            </Row>

            <Row
              label="Review before sprint completion"
              description="Blocks final sprint completion when QA finds integration problems and can route the fix back into the most relevant task."
              badge={qaFieldBadge("agents.qualityAssurance.sprintCompletion.enabled")}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle
                  value={qaSettings.sprintCompletion.enabled}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    sprintCompletion: {
                      ...current.sprintCompletion,
                      enabled: value,
                    },
                  }))}
                />
                <SelectInput
                  value={qaSettings.sprintCompletion.agentPresetId || ""}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    sprintCompletion: {
                      ...current.sprintCompletion,
                      agentPresetId: value || null,
                    },
                  }))}
                  options={qaPresetOptions}
                  disabled={qaPresetSelectorsDisabled}
                  aria-label="Sprint completion QA agent preset"
                />
              </div>
            </Row>

            <Row
              label="Review completed tasks without a PR"
              description="Lets QA investigate whether a missing PR is valid or whether the task still needs branch and PR hygiene before it can stay complete."
              badge={qaFieldBadge("agents.qualityAssurance.completedTaskWithoutPr.enabled")}
              last
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle
                  value={qaSettings.completedTaskWithoutPr.enabled}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    completedTaskWithoutPr: {
                      ...current.completedTaskWithoutPr,
                      enabled: value,
                    },
                  }))}
                />
                <SelectInput
                  value={qaSettings.completedTaskWithoutPr.agentPresetId || ""}
                  onChange={(value) => updateQaSettings((current) => ({
                    ...current,
                    completedTaskWithoutPr: {
                      ...current.completedTaskWithoutPr,
                      agentPresetId: value || null,
                    },
                  }))}
                  options={qaPresetOptions}
                  disabled={qaPresetSelectorsDisabled}
                  aria-label="No PR QA agent preset"
                />
              </div>
            </Row>

            {qaPresetSelectorsDisabled ? (
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

      <SectionCard title="Instruction Templates" watermark="TXT" badge={getBadge("agents")}>
        <Row label="Template" description="Pick the orchestration instruction block you want to edit in the database-backed settings store.">
          <SelectInput
            value={selectedAgentTemplate}
            onChange={(value) => setSelectedAgentTemplate(value as AgentInstructionTemplateId)}
            options={agentInstructionTemplateOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
        </Row>
        <div className="py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
              {selectedTemplateConfig.label}
            </div>
            {getFieldBadge(`agents.instructionTemplates.${selectedAgentTemplate}`) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                  !
                </span>
                {getFieldBadge(`agents.instructionTemplates.${selectedAgentTemplate}`)}
              </span>
            ) : null}
          </div>
          <div className="mb-4 text-xs font-medium leading-relaxed text-slate-400">
            {selectedTemplateConfig.description}
          </div>
          <TextAreaInput
            value={selectedTemplateValue}
            placeholder="Markdown template text with {{variables}} placeholders."
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              agents: {
                ...current.agents,
                instructionTemplates: {
                  ...current.agents.instructionTemplates,
                  [selectedAgentTemplate]: value,
                },
              },
            }))}
          />
        </div>
      </SectionCard>

      <NoticePanel title="Agent sync behavior" tone="success">
        The database stays authoritative for agent records, labels, and routing metadata. When the mirror is enabled, dashboard edits also refresh a project-local markdown file, and local markdown drift can be imported back into the dashboard from the Agents page.
      </NoticePanel>

      <NoticePanel title="Quality assurance behavior">
        QA uses the dedicated `qa_review` invocation route, gets full sprint context like clarification automation, and can continue the active Jules or CLI session with direct fix instructions when it finds gaps.
      </NoticePanel>

      <NoticePanel title="Instruction template storage">
        Sprint protocol and intervention templates are now stored in scoped settings. Built-in defaults stay in code, system scope defines the default copy, and project scope can override any template without relying on `.sprint-os/instructions`.
      </NoticePanel>
    </div>
  );
};
