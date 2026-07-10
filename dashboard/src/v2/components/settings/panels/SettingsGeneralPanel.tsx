import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { ActionFeedbackRegion } from "../../ui/ActionFeedbackRegion.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup, SelectInput } from "../SettingsFormFields.js";
import { LocalFilePickerField } from "../LocalFilePickerField.js";
import type { ProjectSettings } from "../../../../../../src/contracts/settings-scope-types.js";
import type { DashboardExperienceMode } from "../../../../types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Bot, Cog, Database, FolderOpen, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-preact";
import { openOnboarding } from "../../../lib/onboarding-control.js";
import { useProjectData } from "../../../context/project-data.js";
import { dashboardExperienceModeOptions } from "../../../lib/experience-mode.js";

const toRestartSprintPolicy = (value: string) => (
  value === "pause" || value === "cancel" ? value : "continue"
);

const toRestartInvocationPolicy = (value: string) => (
  value === "cancel" || value === "restart" ? value : "continue"
);

const ExperienceModeCard: FunctionComponent<{
  settings: ProjectSettings;
  update: (recipe: (current: ProjectSettings) => ProjectSettings) => void;
  getFieldBadge: (path: string) => string | undefined;
}> = ({ settings, update, getFieldBadge }) => (
  <SectionCard title="Experience Mode" watermark="MODE" icon={<SlidersHorizontal strokeWidth={2.4} />}>
    <Row
      label="Dashboard mode"
      description="Choose how much of the dashboard surface is shown. Hidden routes and settings are preserved."
      badge={getFieldBadge("appearance.experienceMode")}
      last
    >
      <PillChoiceGroup
        aria-label="Dashboard experience mode"
        value={settings.appearance.experienceMode}
        onChange={(value) => update((current) => ({
          ...current,
          appearance: {
            ...current.appearance,
            experienceMode: value as DashboardExperienceMode,
          },
        }))}
        options={dashboardExperienceModeOptions.map((option) => ({
          value: option.value,
          label: option.label,
          hint: option.description,
        }))}
      />
    </Row>
  </SectionCard>
);

const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => {
  const { updateProject } = useProjectData();
  const [projectNameDraft, setProjectNameDraft] = useState(projectName);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setProjectNameDraft(projectName);
    setSaveState("idle");
    setSaveMessage(null);
  }, [projectId, projectName]);

  const trimmedProjectName = projectNameDraft.trim();
  const isInvalidProjectName = trimmedProjectName.length === 0;
  const isDirtyProjectName = trimmedProjectName !== projectName.trim();
  const isSavingProjectName = saveState === "saving";
  const saveDisabledReason = isSavingProjectName
    ? "Project name is saving."
    : isInvalidProjectName
      ? "Enter a project name before saving."
      : !isDirtyProjectName
        ? "No project name changes to save."
        : undefined;
  const sourceTypeLabel = useMemo(() => sourceType === "git" ? "Git repository" : "Local workspace", [sourceType]);

  const saveProjectName = async (): Promise<void> => {
    if (isInvalidProjectName) {
      setSaveState("error");
      setSaveMessage("Project name cannot be empty.");
      return;
    }
    if (!isDirtyProjectName) {
      setProjectNameDraft(projectName);
      setSaveState("idle");
      setSaveMessage(null);
      return;
    }

    setSaveState("saving");
    setSaveMessage(null);
    try {
      const updatedProject = await updateProject(projectId, { name: trimmedProjectName });
      setProjectNameDraft(updatedProject.name);
      setSaveState("saved");
      setSaveMessage("Project name updated.");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Failed to update project name.");
    }
  };

  const resetProjectName = (): void => {
    setProjectNameDraft(projectName);
    setSaveState("idle");
    setSaveMessage(null);
  };

  return (
    <SectionCard title="Project Context" watermark="PRJ" icon={<FolderOpen strokeWidth={2.4} />}>
      <Row label="Project name" description="Rename the selected project. Settings, tasks, and runtime history stay attached to the same project id.">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 sm:min-w-[18rem]">
              <TextInput
                value={projectNameDraft}
                onChange={(value) => {
                  setProjectNameDraft(value);
                  setSaveState("idle");
                  setSaveMessage(null);
                }}
                invalid={saveState === "error" && isInvalidProjectName}
                helperText="The project id, settings, tasks, and runtime history stay unchanged."
                errorText={isInvalidProjectName ? "Project name cannot be empty." : undefined}
                forceValidation={saveState === "error"}
                disabled={isSavingProjectName}
                aria-label="Project name"
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ActionButton
                label="Save Name"
                tone="primary"
                busy={isSavingProjectName}
                disabled={!isDirtyProjectName || isInvalidProjectName}
                disabledReason={saveDisabledReason}
                onClick={() => { void saveProjectName(); }}
              />
              <ActionButton
                label="Reset"
                disabled={!isDirtyProjectName || isSavingProjectName}
                disabledReason={isSavingProjectName ? "Project name is saving." : "No project name changes to reset."}
                onClick={resetProjectName}
              />
            </div>
          </div>
          <ActionFeedbackRegion
            status={saveState === "error" ? "error" : saveState === "saving" ? "pending" : saveState === "saved" ? "success" : isDirtyProjectName ? "warning" : "idle"}
            message={saveMessage || (saveState === "saving" ? "Saving project name..." : isDirtyProjectName ? "Project name has unsaved changes." : null)}
            autoDismiss={false}
          />
        </div>
      </Row>
      <Row label="Project id" description="Stable identifier used by the API and runtime.">
        <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          {projectId}
        </div>
      </Row>
      <Row label="Source type" description="How this project is mounted for local execution.">
        <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
          {sourceTypeLabel}
        </div>
      </Row>
      <Row label="Base directory" description="Workers and local execution enter this directory before acting.">
        <div className="max-w-[28rem] rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          {baseDir}
        </div>
      </Row>
    </SectionCard>
  );
};

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
      <Toggle aria-label="Toggle setting"         value={settings.automationInterventions.autoApprovePlan}
        onChange={() => update((current) => ({
          ...current,
          automationInterventions: {
            ...current.automationInterventions,
            autoApprovePlan: !current.automationInterventions.autoApprovePlan,
          },
        }))}
      />
    </Row>
    <Row label="Auto-resume paused runs" description="Resume a project automatically when a transient pause clears." badge={getFieldBadge("automationInterventions.autoResumePaused")} last>
      <Toggle aria-label="Toggle setting"         value={settings.automationInterventions.autoResumePaused}
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
    <Row label="Runtime image mode" description="Managed mode automatically pulls the verified Code UX Linux runtime and provider updates." badge={getFieldBadge("cliWorkflow.containerImageMode")}>
      <SelectInput
        aria-label="Runtime image mode"
        value={settings.cliWorkflow.containerImageMode}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerImageMode: value === "custom" ? "custom" : "managed",
          },
        }))}
        options={[
          { value: "managed", label: "Managed runtime (recommended)" },
          { value: "custom", label: "Custom image" },
        ]}
      />
    </Row>
    <Row label="Custom container image" description="Used only in custom mode. Managed mode follows verified immutable runtime digests." badge={getFieldBadge("cliWorkflow.containerImage")}>
      <TextInput
        value={settings.cliWorkflow.containerImage}
        disabled={settings.cliWorkflow.containerImageMode !== "custom"}
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
      <LocalFilePickerField
        label="Container setup script"
        value={settings.cliWorkflow.containerSetupScriptPath}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerSetupScriptPath: value,
          },
        }))}
        helperText="Type a relative path or browse to an absolute local script."
        placeholder=".code-ux/container/setup.sh"
      />
    </Row>
    <Row label="Container memory limit" description="Memory ceiling in MiB for all Docker-backed CLI provider containers. Use 0 to disable the cap." badge={getFieldBadge("cliWorkflow.containerMemoryLimitMb")}>
      <NumberInput
        value={settings.cliWorkflow.containerMemoryLimitMb}
        min={0}
        max={262144}
        step={256}
        aria-label="Container memory limit"
        aria-description="Memory ceiling in MiB for all Docker-backed CLI provider containers. Use 0 to disable the cap."
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerMemoryLimitMb: value,
          },
        }))}
      />
    </Row>
    <Row label="Run containers as root" description="Off by default. Enable only for tools that require package-manager or OS-level writes inside Docker." badge={getFieldBadge("cliWorkflow.containerRunAsRoot")}>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          aria-label="Run Docker agents as root"
          value={settings.cliWorkflow.containerRunAsRoot}
          danger={settings.cliWorkflow.containerRunAsRoot}
          onChange={() => update((current) => ({
            ...current,
            cliWorkflow: {
              ...current.cliWorkflow,
              containerRunAsRoot: !current.cliWorkflow.containerRunAsRoot,
            },
          }))}
        />
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
          settings.cliWorkflow.containerRunAsRoot
            ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
            : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
        }`}>
          {settings.cliWorkflow.containerRunAsRoot ? "Root enabled" : "Non-root default"}
        </span>
      </div>
    </Row>
    <Row label="Cache custom setup extension" description="Build and reuse an extension image only when a custom setup script is configured." badge={getFieldBadge("cliWorkflow.containerCacheSetupScriptImage")}>
      <Toggle aria-label="Toggle setting" value={settings.cliWorkflow.containerCacheSetupScriptImage} onChange={() => update((current) => ({
        ...current,
        cliWorkflow: {
          ...current.cliWorkflow,
          containerCacheSetupScriptImage: !current.cliWorkflow.containerCacheSetupScriptImage,
        },
      }))} />
    </Row>
    <Row label="Preinstall Playwright browsers" description="Install Chromium and OS dependencies for browser checks inside coding containers." badge={getFieldBadge("cliWorkflow.containerInstallPlaywrightBrowsers")} last>
      <Toggle aria-label="Toggle setting" value={settings.cliWorkflow.containerInstallPlaywrightBrowsers} onChange={() => update((current) => ({
        ...current,
        cliWorkflow: {
          ...current.cliWorkflow,
          containerInstallPlaywrightBrowsers: !current.cliWorkflow.containerInstallPlaywrightBrowsers,
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
            <>
              <ExperienceModeCard
                settings={editableSettings}
                update={updateEditableSettings}
                getFieldBadge={getFieldBadge}
              />
              <AutomationCard
                settings={editableSettings}
                update={updateEditableSettings}
                getBadge={getBadge}
                getFieldBadge={getFieldBadge}
              />
            </>
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
            <Row label="Console log level" description="Minimum severity printed to the server console. Off suppresses console logging.">
              <PillChoiceGroup
                value={systemSettings?.runtime.consoleLogLevel ?? "info"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    consoleLogLevel: value === "off" || value === "debug" || value === "warn" || value === "error" ? value : "info",
                  },
                }))}
                options={[
                  { value: "off", label: "Off", hint: "Suppress console output." },
                  { value: "debug", label: "Debug", hint: "Everything." },
                  { value: "info", label: "Info", hint: "Normal activity." },
                  { value: "warn", label: "Warn", hint: "Warnings and errors." },
                  { value: "error", label: "Error", hint: "Errors only." },
                ]}
              />
            </Row>
            <Row label="Debug file level" description="Minimum severity written to .code-ux/debug.log. Off disables file logging.">
              <PillChoiceGroup
                value={systemSettings?.runtime.debugLogFileLevel ?? "error"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    debugLogFileLevel: value === "debug" || value === "info" || value === "warn" || value === "off" ? value : "error",
                  },
                }))}
                options={[
                  { value: "off", label: "Off", hint: "Do not write the file." },
                  { value: "debug", label: "Debug", hint: "Everything." },
                  { value: "info", label: "Info", hint: "Normal activity." },
                  { value: "warn", label: "Warn", hint: "Warnings and errors." },
                  { value: "error", label: "Error", hint: "Default for debug.log." },
                ]}
              />
            </Row>
            <Row label="Console visibility" description="Standard hides routine dashboard HTTP request logs. Full includes them." last>
              <PillChoiceGroup
                value={systemSettings?.runtime.consoleLogMode ?? "standard"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    consoleLogMode: value === "full" ? "full" : "standard",
                  },
                }))}
                options={[
                  { value: "standard", label: "Standard", hint: "Important runtime activity." },
                  { value: "full", label: "Full", hint: "Includes HTTP requests." },
                ]}
              />
            </Row>
          </SectionCard>

          <SectionCard title="Restart Behavior" watermark="RST" icon={<RotateCcw strokeWidth={2.4} />}>
            <Row label="After app restart" description="Choose what Code UX does with sprint runs that were active when the runtime stopped.">
              <PillChoiceGroup
                value={systemSettings?.runtime.restartSprintPolicy ?? "continue"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    restartSprintPolicy: toRestartSprintPolicy(value),
                  },
                }))}
                options={[
                  { value: "continue", label: "Continue", hint: "Resume active sprint watch loops." },
                  { value: "pause", label: "Pause", hint: "Hold active sprints for manual resume." },
                  { value: "cancel", label: "Cancel", hint: "Stop active sprint runs on startup." },
                ]}
              />
            </Row>
            <Row label="Interrupted invocations" description="When sprints continue after restart, choose how interrupted provider, QA, and task invocations are reconciled." last>
              <PillChoiceGroup
                value={systemSettings?.runtime.restartInvocationPolicy ?? "continue"}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    restartInvocationPolicy: toRestartInvocationPolicy(value),
                  },
                }))}
                options={[
                  { value: "continue", label: "Continue", hint: "Keep live provider runtimes attached when possible." },
                  { value: "cancel", label: "Cancel", hint: "Mark interrupted work cancelled." },
                  { value: "restart", label: "Restart", hint: "Retry interrupted work from preserved state." },
                ]}
              />
            </Row>
          </SectionCard>

          <SectionCard title="Database Settings" watermark="DBM" icon={<Database strokeWidth={2.4} />}>
            <Row label="Automatic pruning" description="Automatically prune completed task runs, VM activities, attention items, and realtime events on startup.">
              <Toggle aria-label="Toggle setting"                 value={systemSettings?.runtime.dbPruningEnabled ?? true}
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
              <Toggle aria-label="Toggle setting"                 value={systemSettings?.runtime.dbAutoVacuumOnStartup ?? true}
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

        <DockerRuntimeCard
          settings={projectSettings}
          update={updateEditableSettings}
          getBadge={getBadge}
          getFieldBadge={getFieldBadge}
        />
      </div>
    );
  };
