import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { ActionFeedbackRegion } from "../../ui/ActionFeedbackRegion.js";
import { NumberInput, OptionCardChoiceGroup, PillChoiceGroup, Row, Toggle, TextInput, SelectInput } from "../SettingsFormFields.js";
import { LocalFilePickerField } from "../LocalFilePickerField.js";
import { OpenSourceSoftwareModal } from "../OpenSourceSoftwareModal.js";
import type { ProjectSettings, SystemRuntimeSettings } from "../../../../../../src/contracts/settings-scope-types.js";
import type { DashboardExperienceMode } from "../../../../types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Bot, Cog, Database, ExternalLink, FolderOpen, RotateCcw, Scale, SlidersHorizontal, Sparkles } from "lucide-preact";
import { openOnboarding } from "../../../lib/onboarding-control.js";
import { useProjectData } from "../../../context/project-data.js";
import { dashboardExperienceModeOptions } from "../../../lib/experience-mode.js";
import { getSafeUrl } from "../../../lib/safe-url.js";
import { SHARED_INTERACTION_CLASSES } from "../../ui/Button.js";
import { getSettingsOperationsNumberError, useSettingsOperationsTranslations, type SettingsOperationsTranslate } from "../../../i18n/messages/settings-operations.js";

const CODEUX_LICENSE_URL = getSafeUrl("https://github.com/codeux-ai/codeux/blob/main/LICENSE");

const toRestartSprintPolicy = (value: string) => (
  value === "pause" || value === "cancel" ? value : "continue"
);

const toRestartInvocationPolicy = (value: string) => (
  value === "cancel" || value === "restart" ? value : "continue"
);

const getRuntimeLogLevelCaption = (
  value: SystemRuntimeSettings["consoleLogLevel"],
  t: SettingsOperationsTranslate,
): string => {
  switch (value) {
    case "off":
      return t("Off");
    case "debug":
      return t("Debug");
    case "info":
      return t("Info");
    case "warn":
      return t("Warn");
    case "error":
      return t("Error");
  }
};

const ExperienceModeCard: FunctionComponent<{
  settings: ProjectSettings;
  update: (recipe: (current: ProjectSettings) => ProjectSettings) => void;
  getFieldBadge: (path: string) => string | undefined;
}> = ({ settings, update, getFieldBadge }) => {
  const { t } = useSettingsOperationsTranslations();
  const options = dashboardExperienceModeOptions.map((option) => ({
    ...option,
    label: option.value === "EASY" ? t("Easy") : option.value === "STANDARD" ? t("Standard") : t("Expert"),
    description: option.value === "EASY"
      ? t("Simplified dashboard language and fewer advanced controls.")
      : option.value === "STANDARD"
        ? t("Balanced dashboard controls for regular project operation.")
        : t("Full operational detail and advanced controls."),
  }));
  const currentModeLabel = options.find((option) => option.value === settings.appearance.experienceMode)?.label ?? t("Expert");
  return <SectionCard
    title={t("Experience Mode")}
    watermark="MODE"
    icon={<SlidersHorizontal strokeWidth={2.4} />}
    accent="violet"
    summary={t("Choose how much operational detail Code UX shows while keeping every saved setting intact.")}
    highlights={[
      { label: t("Current mode"), value: currentModeLabel, tone: "active" },
      { label: t("Settings depth"), value: settings.appearance.experienceMode === "EXPERT" ? t("All categories") : settings.appearance.experienceMode === "STANDARD" ? t("Common workflows") : t("Essentials only") },
      { label: t("Saved values"), value: t("Always preserved") },
    ]}
    overview={(
      <PillChoiceGroup
        aria-label={t("Quick dashboard experience mode")}
        value={settings.appearance.experienceMode}
        onChange={(value) => update((current) => ({
          ...current,
          appearance: { ...current.appearance, experienceMode: value as DashboardExperienceMode },
        }))}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
      />
    )}
    configureLabel={t("Review mode details")}
  >
    <Row
      label={t("Dashboard mode")}
      description={t("Choose how much of the dashboard surface is shown. Hidden routes and settings are preserved.")}
      badge={getFieldBadge("appearance.experienceMode")}
      last
    >
      <OptionCardChoiceGroup
        aria-label={t("Dashboard experience mode")}
        value={settings.appearance.experienceMode}
        onChange={(value) => update((current) => ({
          ...current,
          appearance: {
            ...current.appearance,
            experienceMode: value as DashboardExperienceMode,
          },
        }))}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
      />
    </Row>
  </SectionCard>;
};

const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => {
  const { t } = useSettingsOperationsTranslations();
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
    ? t("Project name is saving.")
    : isInvalidProjectName
      ? t("Enter a project name before saving.")
      : !isDirtyProjectName
        ? t("No project name changes to save.")
        : undefined;
  const sourceTypeLabel = useMemo(() => sourceType === "git" ? t("Git repository") : t("Local workspace"), [sourceType, t]);

  const saveProjectName = async (): Promise<void> => {
    if (isInvalidProjectName) {
      setSaveState("error");
      setSaveMessage(t("Project name cannot be empty."));
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
      setSaveMessage(t("Project name updated."));
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : t("Failed to update project name."));
    }
  };

  const resetProjectName = (): void => {
    setProjectNameDraft(projectName);
    setSaveState("idle");
    setSaveMessage(null);
  };

  return (
    <SectionCard
      title={t("Project Context")}
      watermark="PRJ"
      icon={<FolderOpen strokeWidth={2.4} />}
      accent="sky"
      highlights={[
        { label: t("Project"), value: projectName, tone: "active" },
        { label: t("Source"), value: sourceTypeLabel },
        { label: t("Workspace"), value: baseDir.split(/[\\/]/).filter(Boolean).at(-1) || baseDir },
      ]}
      configureLabel={t("Manage project details")}
    >
      <Row label={t("Project name")} description={t("Rename the selected project. Settings, tasks, and runtime history stay attached to the same project id.")}>
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
                helperText={t("The project id, settings, tasks, and runtime history stay unchanged.")}
                errorText={isInvalidProjectName ? t("Project name cannot be empty.") : undefined}
                forceValidation={saveState === "error"}
                disabled={isSavingProjectName}
                aria-label={t("Project name")}
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ActionButton
                label={t("Save Name")}
                tone="primary"
                busy={isSavingProjectName}
                disabled={!isDirtyProjectName || isInvalidProjectName}
                disabledReason={saveDisabledReason}
                onClick={() => { void saveProjectName(); }}
              />
              <ActionButton
                label={t("Reset")}
                disabled={!isDirtyProjectName || isSavingProjectName}
                disabledReason={isSavingProjectName ? t("Project name is saving.") : t("No project name changes to reset.")}
                onClick={resetProjectName}
              />
            </div>
          </div>
          <ActionFeedbackRegion
            status={saveState === "error" ? "error" : saveState === "saving" ? "pending" : saveState === "saved" ? "success" : isDirtyProjectName ? "warning" : "idle"}
            message={saveMessage || (saveState === "saving" ? t("Saving project name...") : isDirtyProjectName ? t("Project name has unsaved changes.") : null)}
            autoDismiss={false}
          />
        </div>
      </Row>
      <Row label={t("Project id")} description={t("Stable identifier used by the API and runtime.")}>
        <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          {projectId}
        </div>
      </Row>
      <Row label={t("Source type")} description={t("How this project is mounted for local execution.")}>
        <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
          {sourceTypeLabel}
        </div>
      </Row>
      <Row label={t("Base directory")} description={t("Workers and local execution enter this directory before acting.")}>
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
}> = ({ settings, update, getBadge, getFieldBadge }) => {
  const { t } = useSettingsOperationsTranslations();
  return <SectionCard
    title={t("Automation")}
    watermark="AUTO"
    badge={getBadge("automationLevel", "automationInterventions")}
    icon={<Bot strokeWidth={2.4} />}
    accent="orange"
    highlights={[
      { label: t("Level"), value: settings.automationLevel === "SEMI_AUTO" ? t("Semi-auto") : settings.automationLevel === "ALWAYS_ASK" ? t("Always ask") : t("Full"), tone: "active" },
      { label: t("Plan approval"), value: settings.automationInterventions.autoApprovePlan ? t("Automatic") : t("Manual") },
      { label: t("Paused runs"), value: settings.automationInterventions.autoResumePaused ? t("Auto-resume") : t("Stay paused") },
    ]}
  >
    <Row label={t("Automation level")} description={t("Choose how much the project should proceed without a worker stepping in.")} badge={getFieldBadge("automationLevel")}>
      <PillChoiceGroup
        value={settings.automationLevel}
        onChange={(value) => update((current) => ({ ...current, automationLevel: value as ProjectSettings["automationLevel"] }))}
        options={[
          { value: "FULL", label: t("Full"), hint: t("Moves without confirmation gates.") },
          { value: "SEMI_AUTO", label: t("Semi-auto"), hint: t("Automates routine recovery only.") },
          { value: "ALWAYS_ASK", label: t("Always ask"), hint: t("Requires a decision at every gate.") },
        ]}
      />
    </Row>
    <Row label={t("Auto-approve plans")} description={t("Use the orchestrator path for routine plan confirmations.")} badge={getFieldBadge("automationInterventions.autoApprovePlan")}>
      <Toggle aria-label={t("Toggle setting")} value={settings.automationInterventions.autoApprovePlan}
        onChange={() => update((current) => ({
          ...current,
          automationInterventions: {
            ...current.automationInterventions,
            autoApprovePlan: !current.automationInterventions.autoApprovePlan,
          },
        }))}
      />
    </Row>
    <Row label={t("Auto-resume paused runs")} description={t("Resume a project automatically when a transient pause clears.")} badge={getFieldBadge("automationInterventions.autoResumePaused")} last>
      <Toggle aria-label={t("Toggle setting")} value={settings.automationInterventions.autoResumePaused}
        onChange={() => update((current) => ({
          ...current,
          automationInterventions: {
            ...current.automationInterventions,
            autoResumePaused: !current.automationInterventions.autoResumePaused,
          },
        }))}
      />
    </Row>
  </SectionCard>;
};

const DockerRuntimeCard: FunctionComponent<{
  settings: ProjectSettings;
  update: (recipe: (current: ProjectSettings) => ProjectSettings) => void;
  getBadge: (...prefixes: string[]) => string | undefined;
  getFieldBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge, getFieldBadge }) => {
  const { t } = useSettingsOperationsTranslations();
  return <SectionCard
    title={t("Docker Runtime")}
    watermark="DKR"
    badge={getBadge("cliWorkflow")}
    icon={<Cog strokeWidth={2.4} />}
    accent="blue"
    highlights={[
      { label: t("Image"), value: settings.cliWorkflow.containerImageMode === "custom" ? t("Custom") : t("Managed"), tone: settings.cliWorkflow.containerImageMode === "managed" ? "active" : "warning" },
      { label: t("Memory"), value: settings.cliWorkflow.containerMemoryLimitMb > 0 ? `${settings.cliWorkflow.containerMemoryLimitMb} MiB` : t("Unlimited") },
      { label: t("Container user"), value: settings.cliWorkflow.containerRunAsRoot ? t("Root") : t("Non-root"), tone: settings.cliWorkflow.containerRunAsRoot ? "warning" : "neutral" },
    ]}
  >
    <Row label={t("Runtime image mode")} description={t("Managed mode automatically pulls the verified Code UX Linux runtime and provider updates.")} badge={getFieldBadge("cliWorkflow.containerImageMode")}>
      <SelectInput
        aria-label={t("Runtime image mode")}
        value={settings.cliWorkflow.containerImageMode}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerImageMode: value === "custom" ? "custom" : "managed",
          },
        }))}
        options={[
          { value: "managed", label: t("Managed runtime (recommended)") },
          { value: "custom", label: t("Custom image") },
        ]}
      />
    </Row>
    <Row label={t("Custom container image")} description={t("Used only in custom mode. Managed mode follows verified immutable runtime digests.")} badge={getFieldBadge("cliWorkflow.containerImage")}>
      <TextInput
        value={settings.cliWorkflow.containerImage}
        aria-label={t("Custom container image")}
        aria-description={t("Used only in custom mode. Managed mode follows verified immutable runtime digests.")}
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
    <Row label={t("Container setup script")} description={t("Optional setup script run inside the container before task execution.")} badge={getFieldBadge("cliWorkflow.containerSetupScriptPath")}>
      <LocalFilePickerField
        label={t("Container setup script")}
        value={settings.cliWorkflow.containerSetupScriptPath}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerSetupScriptPath: value,
          },
        }))}
        helperText={t("Type a relative path or browse to an absolute local script.")}
        placeholder=".code-ux/container/setup.sh"
      />
    </Row>
    <Row label={t("Container memory limit")} description={t("Memory ceiling in MiB for all Docker-backed CLI provider containers. Use 0 to disable the cap.")} badge={getFieldBadge("cliWorkflow.containerMemoryLimitMb")}>
      <NumberInput
        value={settings.cliWorkflow.containerMemoryLimitMb}
        min={0}
        max={262144}
        errorText={getSettingsOperationsNumberError(settings.cliWorkflow.containerMemoryLimitMb, 0, 262144, t)}
        step={256}
        aria-label={t("Container memory limit")}
        aria-description={t("Memory ceiling in MiB for all Docker-backed CLI provider containers. Use 0 to disable the cap.")}
        onChange={(value) => update((current) => ({
          ...current,
          cliWorkflow: {
            ...current.cliWorkflow,
            containerMemoryLimitMb: value,
          },
        }))}
      />
    </Row>
    <Row label={t("Run containers as root")} description={t("Off by default. Enable only for tools that require package-manager or OS-level writes inside Docker.")} badge={getFieldBadge("cliWorkflow.containerRunAsRoot")}>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          aria-label={t("Run Docker agents as root")}
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
          {settings.cliWorkflow.containerRunAsRoot ? t("Root enabled") : t("Non-root default")}
        </span>
      </div>
    </Row>
    <Row label={t("Cache custom setup extension")} description={t("Build and reuse an extension image only when a custom setup script is configured.")} badge={getFieldBadge("cliWorkflow.containerCacheSetupScriptImage")}>
      <Toggle aria-label={t("Toggle setting")} value={settings.cliWorkflow.containerCacheSetupScriptImage} onChange={() => update((current) => ({
        ...current,
        cliWorkflow: {
          ...current.cliWorkflow,
          containerCacheSetupScriptImage: !current.cliWorkflow.containerCacheSetupScriptImage,
        },
      }))} />
    </Row>
    <Row label={t("Preload Playwright browser")} description={t("Download the matched browser into a reusable local Docker volume for coding containers.")} badge={getFieldBadge("cliWorkflow.containerInstallPlaywrightBrowsers")} last>
      <Toggle aria-label={t("Toggle setting")} value={settings.cliWorkflow.containerInstallPlaywrightBrowsers} onChange={() => update((current) => ({
        ...current,
        cliWorkflow: {
          ...current.cliWorkflow,
          containerInstallPlaywrightBrowsers: !current.cliWorkflow.containerInstallPlaywrightBrowsers,
        },
      }))} />
    </Row>
  </SectionCard>;
};

export const SettingsGeneralPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { t } = useSettingsOperationsTranslations();
  const [isOpenSourceSoftwareOpen, setIsOpenSourceSoftwareOpen] = useState(false);
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
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
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
          <SectionCard
            title={t("System Runtime")}
            watermark="SYS"
            icon={<Cog strokeWidth={2.4} />}
            accent="sky"
            highlights={[
              { label: t("Dashboard"), value: t("Port {port}", { port: systemSettings?.runtime.dashboardPort ?? 4444 }), tone: "active" },
              { label: t("Console"), value: getRuntimeLogLevelCaption(systemSettings?.runtime.consoleLogLevel ?? "info", t) },
              { label: t("Debug file"), value: getRuntimeLogLevelCaption(systemSettings?.runtime.debugLogFileLevel ?? "error", t) },
            ]}
          >
            <Row label={t("Dashboard port")} description={t("System-wide HTTP port for the dashboard server.")}>
              <NumberInput
                value={systemSettings?.runtime.dashboardPort ?? 4444}
                aria-label={t("Dashboard port")}
                aria-description={t("System-wide HTTP port for the dashboard server.")}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    dashboardPort: value,
                  },
                }))}
                min={1}
                max={65535}
                errorText={getSettingsOperationsNumberError(systemSettings?.runtime.dashboardPort ?? 4444, 1, 65535, t)}
              />
            </Row>
            <Row label={t("Console log level")} description={t("Minimum severity printed to the server console. Off suppresses console logging.")}>
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
                  { value: "off", label: t("Off"), hint: t("Suppress console output.") },
                  { value: "debug", label: t("Debug"), hint: t("Everything.") },
                  { value: "info", label: t("Info"), hint: t("Normal activity.") },
                  { value: "warn", label: t("Warn"), hint: t("Warnings and errors.") },
                  { value: "error", label: t("Error"), hint: t("Errors only.") },
                ]}
              />
            </Row>
            <Row label={t("Debug file level")} description={t("Minimum severity written to .code-ux/debug.log. Off disables file logging.")}>
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
                  { value: "off", label: t("Off"), hint: t("Do not write the file.") },
                  { value: "debug", label: t("Debug"), hint: t("Everything.") },
                  { value: "info", label: t("Info"), hint: t("Normal activity.") },
                  { value: "warn", label: t("Warn"), hint: t("Warnings and errors.") },
                  { value: "error", label: t("Error"), hint: t("Default for debug.log.") },
                ]}
              />
            </Row>
            <Row label={t("Console visibility")} description={t("Standard hides routine dashboard HTTP request logs. Full includes them.")} last>
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
                  { value: "standard", label: t("Standard"), hint: t("Important runtime activity.") },
                  { value: "full", label: t("Full"), hint: t("Includes HTTP requests.") },
                ]}
              />
            </Row>
          </SectionCard>

          <SectionCard
            title={t("Restart Behavior")}
            watermark="RST"
            icon={<RotateCcw strokeWidth={2.4} />}
            accent="orange"
            highlights={[
              { label: t("Active sprints"), value: t((systemSettings?.runtime.restartSprintPolicy ?? "continue") === "pause" ? "Pause" : (systemSettings?.runtime.restartSprintPolicy ?? "continue") === "cancel" ? "Cancel" : "Continue"), tone: "active" },
              { label: t("Invocations"), value: t((systemSettings?.runtime.restartInvocationPolicy ?? "continue") === "cancel" ? "Cancel" : (systemSettings?.runtime.restartInvocationPolicy ?? "continue") === "restart" ? "Restart" : "Continue") },
              { label: t("Applies"), value: t("Next restart") },
            ]}
          >
            <Row label={t("After app restart")} description={t("Choose what Code UX does with sprint runs that were active when the runtime stopped.")}>
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
                  { value: "continue", label: t("Continue"), hint: t("Resume active sprint watch loops.") },
                  { value: "pause", label: t("Pause"), hint: t("Hold active sprints for manual resume.") },
                  { value: "cancel", label: t("Cancel"), hint: t("Stop active sprint runs on startup.") },
                ]}
              />
            </Row>
            <Row label={t("Interrupted invocations")} description={t("When sprints continue after restart, choose how interrupted provider, QA, and task invocations are reconciled.")} last>
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
                  { value: "continue", label: t("Continue"), hint: t("Keep live provider runtimes attached when possible.") },
                  { value: "cancel", label: t("Cancel"), hint: t("Mark interrupted work cancelled.") },
                  { value: "restart", label: t("Restart"), hint: t("Retry interrupted work from preserved state.") },
                ]}
              />
            </Row>
          </SectionCard>

          <SectionCard
            title={t("Database Settings")}
            watermark="DBM"
            icon={<Database strokeWidth={2.4} />}
            accent="purple"
            highlights={[
              { label: t("Pruning"), value: (systemSettings?.runtime.dbPruningEnabled ?? true) ? t("Enabled") : t("Off"), tone: (systemSettings?.runtime.dbPruningEnabled ?? true) ? "active" : "warning" },
              { label: t("Retention"), value: t("{days} days", { days: systemSettings?.runtime.dbRetentionDays ?? 14 }) },
              { label: t("Startup vacuum"), value: (systemSettings?.runtime.dbAutoVacuumOnStartup ?? true) ? t("Enabled") : t("Off") },
              { label: t("Startup vacuum"), value: (systemSettings?.runtime.dbAutoVacuumOnStartup ?? false) ? t("Enabled") : t("Off") },
            ]}
          >
            <Row label={t("Automatic pruning")} description={t("Automatically prune completed task runs, VM activities, attention items, and realtime events on startup.")}>
              <Toggle aria-label={t("Toggle setting")} value={systemSettings?.runtime.dbPruningEnabled ?? true}
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
              <Row label={t("Log retention period (days)")} description={t("Keep execution logs and session histories for this many days.")}>
                <NumberInput
                  value={systemSettings?.runtime.dbRetentionDays ?? 14}
                  aria-label={t("Log retention period (days)")}
                  aria-description={t("Keep execution logs and session histories for this many days.")}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    runtime: {
                      ...current.runtime,
                      dbRetentionDays: value,
                    },
                  }))}
                  min={1}
                  max={365}
                  errorText={getSettingsOperationsNumberError(systemSettings?.runtime.dbRetentionDays ?? 14, 1, 365, t)}
                />
              </Row>
            )}
            <Row label={t("Automatic vacuum on startup")} description={t("Reclaim fragmented SQLite page storage space and shrink DB files on disk after pruning.")} last>
              <Toggle aria-label={t("Toggle setting")} value={systemSettings?.runtime.dbAutoVacuumOnStartup ?? false}
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

          <SectionCard title={t("Onboarding")} watermark="ONB" icon={<Sparkles strokeWidth={2.4} />} accent="fuchsia">
            <Row label={t("Show onboarding again")} description={t("Launch the interactive setup flow from the beginning.")} last>
              <ActionButton label={t("Open Onboarding")} tone="primary" onClick={openOnboarding} />
            </Row>
          </SectionCard>

          <SectionCard title={t("License & Open Source")} watermark="OSS" icon={<Scale strokeWidth={2.4} />}>
            <Row label={t("License")} description={t("Read the canonical Code UX license in the project repository.")}>
              <a
                href={CODEUX_LICENSE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("Open the Code UX license in a new tab")}
                className={`${SHARED_INTERACTION_CLASSES} inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white`}
              >
                {t("View License")}
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </Row>
            <Row label={t("Open Source Software")} description={t("Browse the licenses and project sites for software distributed with Code UX.")} last>
              <ActionButton label={t("Open Source Software")} onClick={() => setIsOpenSourceSoftwareOpen(true)} />
            </Row>
          </SectionCard>

          <OpenSourceSoftwareModal
            isOpen={isOpenSourceSoftwareOpen}
            onClose={() => setIsOpenSourceSoftwareOpen(false)}
          />
        </div>
      );
    }

    if (!selectedProject || !projectSettings) {
      return (
        <NoticePanel title={t("Project scope unavailable")}>
          {t("Select a project first to edit inheritable project settings.")}
        </NoticePanel>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
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
