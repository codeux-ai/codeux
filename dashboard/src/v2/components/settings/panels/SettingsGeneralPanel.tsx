import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings } from "../../../../../../src/contracts/settings-scope-types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";


const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => (
  <SectionCard title="Project Context" watermark="PRJ">
    <Row label="Project" description="The selected project receives its own override document and inherits all other values from system defaults.">
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
        {projectName}
      </div>
    </Row>
    <Row label="Project id" description="Stable identifier used by the API and runtime." >
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {projectId}
      </div>
    </Row>
    <Row label="Base directory" description="Workers and local execution enter this directory before acting." >
      <div className="max-w-[28rem] rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {baseDir}
      </div>
    </Row>
  </SectionCard>
);

export const SettingsGeneralPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    systemSettings,
    projectSettings,
    selectedProject,
    updateSystem,
    updateProject,
    projectSources,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);
    if (activeScope === "system") {
      return (
        <div className="flex flex-col gap-5">
          <SectionCard title="System Runtime" watermark="SYS">
            <Row label="Dashboard port" description="System-wide HTTP port for the dashboard server.">
              <NumberInput
                value={systemSettings?.runtime.dashboardPort ?? 4444}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    dashboardPort: value,
                  },
                }))}
                min={1}
                max={65535}
              />
            </Row>
            <Row label="Debug log file" description="Write extra runtime diagnostics to disk for development and incident analysis." last>
              <Toggle
                value={systemSettings?.runtime.enableDebugLogFile ?? false}
                onChange={() => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    enableDebugLogFile: !current.runtime.enableDebugLogFile,
                  },
                }))}
              />
            </Row>
          </SectionCard>

          <SectionCard title="Inheritance Model" watermark="SCP">
            <NoticePanel title="Scope order" tone="success">
              System settings provide the live baseline. Project settings inherit from that baseline and only persist real overrides. Sprint overrides layer on top from the sprint page.
            </NoticePanel>
            <Row label="Selected project" description="Project-specific overrides are edited in the same page by switching scope.">
              <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
                {selectedProject ? selectedProject.name : "No project selected"}
              </div>
            </Row>
            <Row label="Project inheritance" description="System defaults stay live until a project explicitly overrides a field." last>
              <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                Live inheritance
              </div>
            </Row>
          </SectionCard>
        </div>
      );
    }

    if (!selectedProject || !projectSettings) {
      return (
        <NoticePanel title="Project scope unavailable">
          Select a project first to edit inheritable project settings.
        </NoticePanel>
      );
    }

    return (
      <div className="flex flex-col gap-5">
        <ProjectContextCard
          projectName={selectedProject.name}
          projectId={selectedProject.id}
          baseDir={selectedProject.baseDir}
          sourceType={selectedProject.sourceType}
        />

        <SectionCard title="Automation" watermark="AUTO" badge={getBadge("automationLevel", "automationInterventions")}>
          <Row label="Automation level" description="Choose how much the project should proceed without a worker stepping in." badge={getFieldBadge("automationLevel")}>
            <PillChoiceGroup
              value={projectSettings.automationLevel}
              onChange={(value) => updateProject((current) => ({ ...current, automationLevel: value as ProjectSettings["automationLevel"] }))}
              options={[
                { value: "FULL", label: "Full", hint: "Moves without confirmation gates." },
                { value: "SEMI_AUTO", label: "Semi-auto", hint: "Automates routine recovery only." },
                { value: "ALWAYS_ASK", label: "Always ask", hint: "Requires a decision at every gate." },
              ]}
            />
          </Row>
          <Row label="Auto-approve plans" description="Use the orchestrator path for routine plan confirmations." badge={getFieldBadge("automationInterventions.autoApprovePlan")}>
            <Toggle
              value={projectSettings.automationInterventions.autoApprovePlan}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoApprovePlan: !current.automationInterventions.autoApprovePlan,
                },
              }))}
            />
          </Row>
          <Row label="Auto-answer clarifications" description="Answer routine clarification requests automatically when the configured template is sufficient." badge={getFieldBadge("automationInterventions.autoAnswerClarification")}>
            <Toggle
              value={projectSettings.automationInterventions.autoAnswerClarification}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoAnswerClarification: !current.automationInterventions.autoAnswerClarification,
                },
              }))}
            />
          </Row>
          {projectSettings.automationInterventions.autoAnswerClarification && (
            <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getFieldBadge("automationInterventions.autoAnswerClarificationMode")}>
              <PillChoiceGroup
                value={projectSettings.automationInterventions.autoAnswerClarificationMode}
                onChange={(value) => updateProject((current) => ({
                  ...current,
                  automationInterventions: {
                    ...current.automationInterventions,
                    autoAnswerClarificationMode: value as ProjectSettings["automationInterventions"]["autoAnswerClarificationMode"],
                  },
                }))}
                options={[
                  { value: "TEMPLATE", label: "Template", hint: "Fast static reply." },
                  { value: "WORKER", label: "Worker", hint: "Contextual provider-generated reply." },
                ]}
              />
            </Row>
          )}
          {(!projectSettings.automationInterventions.autoAnswerClarification || projectSettings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") && (
            <Row label="Clarification answer template" description="Template used when project automation answers a clarification request." badge={getFieldBadge("automationInterventions.clarificationAnswerTemplate")}>
              <TextInput
                value={projectSettings.automationInterventions.clarificationAnswerTemplate}
                onChange={(value) => updateProject((current) => ({
                  ...current,
                  automationInterventions: {
                    ...current.automationInterventions,
                    clarificationAnswerTemplate: value,
                  },
                }))}
                placeholder="Respond with the usual clarification template..."
              />
            </Row>
          )}
          <Row label="Auto-resume paused runs" description="Resume a project automatically when a transient pause clears." badge={getFieldBadge("automationInterventions.autoResumePaused")} last>
            <Toggle
              value={projectSettings.automationInterventions.autoResumePaused}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoResumePaused: !current.automationInterventions.autoResumePaused,
                },
              }))}
            />
          </Row>
        </SectionCard>
      </div>
    );
  };
