import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState, AgentInstructionTemplateId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { Row, Toggle, TextAreaInput, SelectInput } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Bot } from "lucide-preact";

  export const SettingsAgentsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    editableSettings,
    projectSources,
    selectedAgentTemplate,
    setSelectedAgentTemplate,
    agentInstructionTemplateOptions,
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

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Project Markdown Mirror" watermark="AGT" badge={getBadge("agents")}>
          <Row label="Save agent markdown to project directory" description="When enabled, dashboard edits write a companion markdown file under `.sprint-os/agents` for the selected project. Default and home agent files are never modified." badge={getFieldBadge("agents.saveToProjectDirectory")}>
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

        <NoticePanel title="Instruction template storage">
          Sprint protocol and intervention templates are now stored in scoped settings. Built-in defaults stay in code, system scope defines the default copy, and project scope can override any template without relying on `.sprint-os/instructions`.
        </NoticePanel>
      </div>
    );
  };
