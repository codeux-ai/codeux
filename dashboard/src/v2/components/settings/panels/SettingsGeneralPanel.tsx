import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings } from "../../../../../../src/contracts/settings-scope-types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Bot, Cog, Database, FolderOpen, Sparkles } from "lucide-preact";
import { openOnboarding } from "../../../lib/onboarding-control.js";


const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => (
  <SectionCard title="Project Context" watermark="PRJ" icon={<FolderOpen strokeWidth={2.4} />}>
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

const AutomationCard: FunctionComponent<{
  settings: ProjectSettings;
  update: (recipe: (current: ProjectSettings) => ProjectSettings) => void;
  getBadge: (...prefixes: string[]) => string | undefined;
  getFieldBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge, getFieldBadge }) => (
  <SectionCard title="Automation" watermark="AUTO" badge={getBadge("automationLevel", "automationInterventions")} icon={<Bot strokeWidth={2.4} />}>
    <Row label="Automation level" description="Choose how much the project should proceed without a worker stepping in." badge={getFieldBadge("automationLevel")}>
      <PillChoiceGroup
        value={settings.automationLevel}
        onChange={(value) => update((current) => ({ ...current, automationLevel: value as ProjectSettings["automationLevel"] }))}
        options={[
          { value: "FULL", label: "Full", hint: "Moves without confirmation gates." },
          { value: "SEMI_AUTO", label: "Semi-auto", hint: "Automates routine recovery only." },
          { value: "ALWAYS_ASK", label: "Always ask", hint: "Requires a decision at every gate." },
        ]}
      />
    </Row>
    <Row label="Auto-approve plans" description="Use the orchestrator path for routine plan confirmations." badge={getFieldBadge("automationInterventions.autoApprovePlan")}>
      <Toggle
        value={settings.automationInterventions.autoApprovePlan}
        onChange={() => update((current) => ({
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
        value={settings.automationInterventions.autoAnswerClarification}
        onChange={() => update((current) => ({
          ...current,
          automationInterventions: {
            ...current.automationInterventions,
            autoAnswerClarification: !current.automationInterventions.autoAnswerClarification,
          },
        }))}
      />
    </Row>
    {settings.automationInterventions.autoAnswerClarification && (
      <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getFieldBadge("automationInterventions.autoAnswerClarificationMode")}>
        <PillChoiceGroup
          value={settings.automationInterventions.autoAnswerClarificationMode}
          onChange={(value) => update((current) => ({
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
    {(!settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") && (
      <Row label="Clarification answer template" description="Template used when project automation answers a clarification request." badge={getFieldBadge("automationInterventions.clarificationAnswerTemplate")}>
        <TextInput
          value={settings.automationInterventions.clarificationAnswerTemplate}
          onChange={(value) => update((current) => ({
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
        value={settings.automationInterventions.autoResumePaused}
        onChange={() => update((current) => ({
          ...current,
          automationInterventions: {
            ...current.automationInterventions,
            autoResumePaused: !current.automationInterventions.autoResumePaused,
          },
        }))}
      />
    </Row>
  </SectionCard>
);

const DockerRuntimeCard: FunctionComponent<{
  settings: ProjectSettings;
  update: (recipe: (current: ProjectSettings) => ProjectSettings) => void;
  getBadge: (...prefixes: string[]) => string | undefined;
  getFieldBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge, getFieldBadge }) => (
  <SectionCard title="Docker Runtime" watermark="DKR" badge={getBadge("cliWorkflow")} icon={<Cog strokeWidth={2.4} />}>
    <Row label="Container image" description="Default container image used for the task execution runtime." badge={getFieldBadge("cliWorkflow.containerImage")}>
      <TextInput
        value={settings.cliWorkflow.containerImage}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerImage: value,
          },
        }))}
        mono
      />
    </Row>
    <Row label="Container setup script" description="Optional setup script run inside the container before task execution." badge={getFieldBadge("cliWorkflow.containerSetupScriptPath")}>
      <TextInput
        value={settings.cliWorkflow.containerSetupScriptPath}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerSetupScriptPath: value,
          },
        }))}
        mono
      />
    </Row>
    <Row label="Cache setup as image" description="Build and reuse a derived Docker image from the base image plus setup script contents." badge={getFieldBadge("cliWorkflow.containerCacheSetupScriptImage")} last>
      <Toggle value={settings.cliWorkflow.containerCacheSetupScriptImage} onChange={() => update((current) => ({
        ...current,
        cliWorkflow: {
          ...current.cliWorkflow,
          containerCacheSetupScriptImage: !current.cliWorkflow.containerCacheSetupScriptImage,
        },
      }))} />
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
    editableSettings,
    updateEditableSettings,
    projectSources,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);
    if (activeScope === "system") {
      return (
        <div className="flex flex-col gap-5">
          {editableSettings ? (
            <AutomationCard
              settings={editableSettings}
              update={updateEditableSettings}
              getBadge={getBadge}
              getFieldBadge={getFieldBadge}
            />
          ) : null}
          <SectionCard title="System Runtime" watermark="SYS" icon={<Cog strokeWidth={2.4} />}>
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
            <Row label="Debug log file" description="Write extra runtime diagnostics to disk for development and incident analysis.">
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
            <Row label="Console Log Level" description="Standard keeps important lifecycle and invocation logs visible. Full also prints routine dashboard HTTP requests." last>
              <PillChoiceGroup
                value={systemSettings?.runtime.consoleLogLevel ?? "standard"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    consoleLogLevel: value === "full" ? "full" : "standard",
                  },
                }))}
                options={[
                  { value: "standard", label: "Standard", hint: "Important runtime activity." },
                  { value: "full", label: "Full", hint: "Includes HTTP requests." },
                ]}
              />
            </Row>
          </SectionCard>

          <SectionCard title="Database Settings" watermark="DBM" icon={<Database strokeWidth={2.4} />}>
            <Row label="Automatic pruning" description="Automatically prune completed task runs, VM activities, attention items, and realtime events on startup.">
              <Toggle
                value={systemSettings?.runtime.dbPruningEnabled ?? true}
                onChange={() => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    dbPruningEnabled: !current.runtime.dbPruningEnabled,
                  },
                }))}
              />
            </Row>
            {(systemSettings?.runtime.dbPruningEnabled ?? true) && (
              <Row label="Log retention period (days)" description="Keep execution logs and session histories for this many days.">
                <NumberInput
                  value={systemSettings?.runtime.dbRetentionDays ?? 14}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    runtime: {
                      ...current.runtime,
                      dbRetentionDays: value,
                    },
                  }))}
                  min={1}
                  max={365}
                />
              </Row>
            )}
            <Row label="Automatic vacuum on startup" description="Reclaim fragmented SQLite page storage space and shrink DB files on disk after pruning." last>
              <Toggle
                value={systemSettings?.runtime.dbAutoVacuumOnStartup ?? true}
                onChange={() => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    dbAutoVacuumOnStartup: !current.runtime.dbAutoVacuumOnStartup,
                  },
                }))}
              />
            </Row>
          </SectionCard>

          {editableSettings ? (
            <DockerRuntimeCard
              settings={editableSettings}
              update={updateEditableSettings}
              getBadge={getBadge}
              getFieldBadge={getFieldBadge}
            />
          ) : null}

          <SectionCard title="Onboarding" watermark="ONB" icon={<Sparkles strokeWidth={2.4} />}>
            <Row label="Show onboarding again" description="Launch the interactive setup flow from the beginning." last>
              <ActionButton label="Open Onboarding" tone="primary" onClick={openOnboarding} />
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

        <AutomationCard
          settings={projectSettings}
          update={updateEditableSettings}
          getBadge={getBadge}
          getFieldBadge={getFieldBadge}
        />
      </div>
    );
  };
