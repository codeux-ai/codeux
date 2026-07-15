import type { FunctionComponent, ComponentChildren, ComponentProps } from "preact";
import { useId } from "preact/hooks";
import type { ProjectSettings, SettingsValueSource, ThinkingMode } from "../../../types.js";
import { PreviewEnvironmentEditor as BasePreviewEnvironmentEditor } from "../browser/PreviewEnvironmentEditor.js";
import { AvantgardeSelect as BaseAvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { TextInput as BaseTextInput, TextAreaInput, NumberInput, SelectInput as BaseSelectInput, Toggle as BaseToggle } from "./SettingsFormFields.js";
import {
  getFieldSource,
  getFieldSourceLabel,
  getSectionSource,
  getProviderModelOptions,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
  sourceLabel,
  thinkingModeOptions,
  providerLabels,
  type SettingsEditorScope,
} from "../../lib/settings-view-models.js";
import { Card as BaseCard, OverrideBadge, Row as BaseRow } from "./panels/SharedPanelComponents.js";
import { AutomationPanel } from "./panels/AutomationPanel.js";
import { ProviderPanel } from "./panels/ProviderPanel.js";
import { WorkerPanel } from "./panels/WorkerPanel.js";
import { InfoIconPopover as BaseInfoIconPopover } from "../ui/InfoIconPopover.js";
import { BranchNameSchemeEditor, TaskPrTitleSchemeEditor } from "./BranchNameSchemeEditor.js";
import { LocalFilePickerField as BaseLocalFilePickerField } from "./LocalFilePickerField.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { translateProjectSettingsLiteral } from "../../i18n/messages/sprint-authoring.js";

const useSettingsLiteral = (): ((value: string) => string) => {
  const { locale } = useDashboardI18n();
  return (value: string): string => translateProjectSettingsLiteral(locale, value);
};

const Card: FunctionComponent<ComponentProps<typeof BaseCard>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseCard {...props} title={tr(props.title)} description={props.description ? tr(props.description) : props.description} badge={props.badge ? tr(props.badge) : props.badge} />;
};

const Row: FunctionComponent<ComponentProps<typeof BaseRow>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseRow {...props} label={tr(props.label)} description={props.description ? tr(props.description) : props.description} badge={props.badge ? tr(props.badge) : props.badge} />;
};

const Toggle: FunctionComponent<ComponentProps<typeof BaseToggle>> = (props) => {
  const tr = useSettingsLiteral();
  const ariaDescription = props["aria-description"];
  const localizedDescription = typeof ariaDescription === "string" ? tr(ariaDescription) : ariaDescription;
  if ("aria-label" in props) {
    return <BaseToggle {...props} aria-label={tr(props["aria-label"])} aria-description={localizedDescription} />;
  }
  return <BaseToggle {...props} aria-labelledby={props["aria-labelledby"]} aria-description={localizedDescription} />;
};

const TextInput: FunctionComponent<ComponentProps<typeof BaseTextInput>> = (props) => {
  const tr = useSettingsLiteral();
  return (
    <BaseTextInput
      {...props}
      aria-label={props["aria-label"] ? tr(props["aria-label"]) : props["aria-label"]}
      aria-description={props["aria-description"] ? tr(props["aria-description"]) : props["aria-description"]}
    />
  );
};

const SelectInput: FunctionComponent<ComponentProps<typeof BaseSelectInput>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseSelectInput {...props} aria-label={props["aria-label"] ? tr(props["aria-label"]) : props["aria-label"]} disabledReason={props.disabledReason ? tr(props.disabledReason) : props.disabledReason} options={props.options.map((option) => ({ ...option, label: tr(option.label) }))} />;
};

const AvantgardeSelect: FunctionComponent<ComponentProps<typeof BaseAvantgardeSelect>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseAvantgardeSelect {...props} aria-label={props["aria-label"] ? tr(props["aria-label"]) : props["aria-label"]} placeholder={props.placeholder ? tr(props.placeholder) : props.placeholder} options={props.options.map((option) => ({ ...option, label: tr(option.label) }))} />;
};

const LocalFilePickerField: FunctionComponent<ComponentProps<typeof BaseLocalFilePickerField>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseLocalFilePickerField {...props} label={tr(props.label)} helperText={props.helperText ? tr(props.helperText) : props.helperText} placeholder={props.placeholder ? tr(props.placeholder) : props.placeholder} />;
};

const PreviewEnvironmentEditor: FunctionComponent<ComponentProps<typeof BasePreviewEnvironmentEditor>> = (props) => {
  const tr = useSettingsLiteral();
  return <BasePreviewEnvironmentEditor {...props} addLabel={props.addLabel ? tr(props.addLabel) : props.addLabel} valueLabel={props.valueLabel ? tr(props.valueLabel) : props.valueLabel} />;
};

const InfoIconPopover: FunctionComponent<ComponentProps<typeof BaseInfoIconPopover>> = (props) => {
  const tr = useSettingsLiteral();
  return <BaseInfoIconPopover {...props} items={props.items?.map((item) => ({ ...item, desc: tr(item.desc) }))} />;
};


export interface ProjectSettingsEditorProps {
  settings: ProjectSettings;
  onChange: (next: ProjectSettings) => void;
  sources?: Record<string, SettingsValueSource>;
  editingScope?: SettingsEditorScope;
}

export const ProjectSettingsEditor: FunctionComponent<ProjectSettingsEditorProps> = ({
  settings,
  onChange,
  sources,
  editingScope = "project",
}) => {
  const tr = useSettingsLiteral();
  const update = (patch: Partial<ProjectSettings>) => onChange({ ...settings, ...patch });
  const virtualWorkerModeEnabled = settings.workers.executionMode === "VIRTUAL";
  const localGitModeReasonId = useId();
  const localGitModeDisabled = settings.git.githubMode === "LOCAL";
  const localGitModeReason = tr("Local Git mode keeps orchestration repo-local, so pull request, linked issue, and CI automation controls are disabled until GitHub mode is Remote.");
  const getBadge = (path: string): string | undefined => {
    if (!sources) {
      return undefined;
    }
    const label = getFieldSourceLabel(getFieldSource(sources, path), editingScope);
    return label ? tr(label) : undefined;
  };

  const automationSource = sources ? getSectionSource(sources, "automationLevel") : undefined;
  const providerSource = sources ? getSectionSource(sources, "aiProvider") : undefined;
  const gitSource = sources ? getSectionSource(sources, "git") : undefined;
  const ciSource = sources ? getSectionSource(sources, "ciIntelligence") : undefined;
  const loopSource = sources ? getSectionSource(sources, "sprintLoopSteps") : undefined;
  const cliSource = sources ? getSectionSource(sources, "cliWorkflow") : undefined;
  const sprintPreviewSource = sources ? getSectionSource(sources, "sprintPreview") : undefined;
  const workerSource = sources ? getSectionSource(sources, "workers") : undefined;
  const skillsSource = sources ? getSectionSource(sources, "skills") : undefined;

  return (
    <div className="space-y-6">
      <AutomationPanel
        settings={settings}
        update={update}
        getBadge={getBadge}
        sourceLabel={automationSource ? sourceLabel(automationSource) : undefined}
      />

      <Card
        title={tr("AI Models")}
        description={tr("Set provider defaults, invocation routing, model mix, and worker runtime settings this scope should use.")}
        badge={providerSource || workerSource ? sourceLabel(providerSource === workerSource ? (providerSource || "system") : "mixed") : undefined}
      >
        <WorkerPanel
          settings={settings}
          update={update}
          getBadge={getBadge}
        />
        <ProviderPanel
          settings={settings}
          update={update}
          getBadge={getBadge}
        />
      </Card>

      <Card
        title={tr("Git Flow")}
        description={tr("Branching and PR behavior for orchestrated work.")}
        badge={gitSource ? sourceLabel(gitSource) : undefined}
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("GitHub mode")} description={tr("Local disables PR intelligence, remote enables PR and CI awareness.")} badge={getBadge("git.githubMode")}>
            <SelectInput
              value={settings.git.githubMode}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  githubMode: value as ProjectSettings["git"]["githubMode"],
                },
              })}
              options={[
                { value: "LOCAL", label: "Local" },
                { value: "REMOTE", label: "Remote" },
              ]}
            />
          </Row>
          <Row label={tr("Default branch")} description={tr("Base branch used for sprint creation and merge targets.")} badge={getBadge("git.defaultBranch")}>
            <TextInput
              value={settings.git.defaultBranch}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  defaultBranch: value,
                },
              })}
              mono
            />
          </Row>
          <Row label={tr("Feature branch prefix")} description={tr("Prefix used when feature branches are generated automatically.")} badge={getBadge("git.featureBranchPrefix")}>
            <TextInput
              value={settings.git.featureBranchPrefix}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  featureBranchPrefix: value,
                },
              })}
              mono
            />
          </Row>
          <Row label={tr("Sprint branch scheme")} description={tr("Template used when naming sprint branches.")} badge={getBadge("git.sprintBranchScheme")} info={<InfoIconPopover items={[
            { key: "{sprint_key_prefix}", desc: "Sprint Key Prefix" },
            { key: "{sprint_number}", desc: "Sprint Number" },
            { key: "{sprint_name}", desc: "Sprint Name" },
            { key: "{sprint_id}", desc: "Sprint ID" },
            { key: "{planning_agent}", desc: "Planning Agent" },
            { key: "{agent_routing}", desc: "Agent Routing" },
            { key: "{worker_agent}", desc: "Worker Agent" },
          ]} />}>
            <BranchNameSchemeEditor
              value={settings.git.sprintBranchScheme}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  sprintBranchScheme: value,
                },
              })}
            />
          </Row>
          <Row label={tr("Task PR title scheme")} description={tr("Template used when naming automatically-created task pull requests.")} badge={getBadge("git.taskPrTitleScheme")}>
            <TaskPrTitleSchemeEditor
              value={settings.git.taskPrTitleScheme}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  taskPrTitleScheme: value,
                },
              })}
            />
          </Row>

        </div>
        {localGitModeDisabled ? (
          <div
            id={localGitModeReasonId}
            className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-xs font-semibold leading-relaxed text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/[0.08] dark:text-amber-200"
          >
            {localGitModeReason}
          </div>
        ) : null}
        <Row label={tr("Auto-create PRs")} description={localGitModeDisabled ? "Open pull requests automatically for remote git workflows. Disabled while GitHub mode is Local." : "Open pull requests automatically for remote git workflows."} badge={getBadge("git.autoCreatePr")}>
          <Toggle aria-label={tr("Auto-create PRs")} aria-description={localGitModeDisabled ? localGitModeReason : "Open pull requests automatically for remote git workflows."} aria-describedby={localGitModeDisabled ? localGitModeReasonId : undefined} value={localGitModeDisabled ? false : settings.git.autoCreatePr}
            disabled={localGitModeDisabled}
            onChange={(value) => update({
              git: {
                ...settings.git,
                autoCreatePr: value,
              },
            })}
          />
        </Row>
        <Row label={tr("Auto-close linked issues")} description={localGitModeDisabled ? "Close imported GitHub/GitLab issues after the sprint finishes. Disabled while GitHub mode is Local." : "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete."} badge={getBadge("git.autoCloseLinkedIssues")}>
          <Toggle aria-label={tr("Auto-close linked issues")} aria-description={localGitModeDisabled ? localGitModeReason : "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete."} aria-describedby={localGitModeDisabled ? localGitModeReasonId : undefined} value={localGitModeDisabled ? false : settings.git.autoCloseLinkedIssues}
            disabled={localGitModeDisabled}
            onChange={(value) => update({
              git: {
                ...settings.git,
                autoCloseLinkedIssues: value,
              },
            })}
          />
        </Row>
      </Card>

      <Card
        title={localGitModeDisabled ? "CI Intelligence (Unavailable in Local Mode)" : "CI Intelligence"}
        description={localGitModeDisabled ? "Controls how aggressively the sprint loop waits on checks, comments, and autofix behavior. Disabled while GitHub mode is Local." : "Controls how aggressively the sprint loop waits on checks, comments, and autofix behavior."}
        badge={localGitModeDisabled ? "Disabled in Local Mode" : (ciSource ? sourceLabel(ciSource) : undefined)}
      >
        {[
          ["enabled", "Enable CI intelligence", "Turn CI and PR gate reasoning on for this scope."],
          ["enableLivePrMonitoring", "Live PR monitoring", "Track PR and CI updates while runs are active."],
          ["resolveAllCommentsBeforeMainMerge", "Resolve comments before main merge", "Require review comment resolution before main branch merge."],
          ["resolveMainMergeConflicts", "Resolve main merge conflicts", "Escalate main-branch merge conflicts to the virtual worker with branch and sprint context."],
          ["resolveMainMergeFailedChecks", "Fix main merge CI failures", "Dispatch the virtual worker to fix failing CI on the main-branch merge gate before escalating to a human."],
          ["resolveAllCommentsBeforeFeatureMerge", "Resolve comments before feature merge", "Require review comment resolution before feature branch merge."],
          ["resolveMergeConflicts", "Resolve feature merge conflicts", "Escalate feature-branch merge conflicts to the virtual worker with branch and prompt context."],
        ].map(([field, label, description]) => (
          <Row key={field} label={label} description={description} badge={getBadge(`ciIntelligence.${field}`)}>
            <Toggle aria-label={label} aria-description={localGitModeDisabled ? localGitModeReason : description} aria-describedby={localGitModeDisabled ? localGitModeReasonId : undefined} value={localGitModeDisabled ? false : (settings.ciIntelligence[field as keyof ProjectSettings["ciIntelligence"]] as boolean)}
              disabled={localGitModeDisabled}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  [field]: value,
                },
              })}
            />
          </Row>
        ))}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("Feature PR auto-merge")} description={tr("Policy for leaving feature work at PR creation or merging after checks and comments are satisfied.")} badge={getBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <SelectInput
              value={localGitModeDisabled ? "OFF" : settings.ciIntelligence.featurePrAutoMergeMode}
              disabled={localGitModeDisabled}
              disabledReason={localGitModeDisabled ? localGitModeReason : undefined}
              aria-label={tr("Feature PR auto-merge")}
              aria-describedby={localGitModeDisabled ? localGitModeReasonId : undefined}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  featurePrAutoMergeMode: value as ProjectSettings["ciIntelligence"]["featurePrAutoMergeMode"],
                },
              })}
              options={[
                { value: "OFF", label: "Off" },
                { value: "CREATE_PR", label: "Create PR" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
          <Row label={tr("Main branch auto-merge")} description={tr("Policy for leaving the final main PR at creation or merging it after checks and comments are satisfied.")} badge={getBadge("ciIntelligence.mainBranchAutoMergeMode")}>
            <SelectInput
              value={localGitModeDisabled ? "OFF" : settings.ciIntelligence.mainBranchAutoMergeMode}
              disabled={localGitModeDisabled}
              disabledReason={localGitModeDisabled ? localGitModeReason : undefined}
              aria-label={tr("Main branch auto-merge")}
              aria-describedby={localGitModeDisabled ? localGitModeReasonId : undefined}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  mainBranchAutoMergeMode: value as ProjectSettings["ciIntelligence"]["mainBranchAutoMergeMode"],
                },
              })}
              options={[
                { value: "OFF", label: "Off" },
                { value: "CREATE_PR", label: "Create PR" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
        </div>
      </Card>

      <Card
        title={tr("Sprint Loop")}
        description={tr("Enable or disable orchestration phases and tune watch-loop timing.")}
        badge={loopSource ? sourceLabel(loopSource) : undefined}
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {[
            ["branchPreflight", "Branch preflight"],
            ["planningPreflight", "Planning preflight"],
            ["loadSubtasks", "Load subtasks"],
            ["sessionSync", "Session sync"],
            ["statusDerivation", "Status derivation"],
            ["startReadyTasks", "Start ready tasks"],
            ["mergeProtocol", "Merge protocol"],
            ["actionRequiredProtocol", "Action-required protocol"],
            ["statusTable", "Status table"],
            ["watchLoop", "Watch loop"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Toggle the ${label.toLowerCase()} phase for this scope.`} badge={getBadge(`sprintLoopSteps.${field}`)}>
              <Toggle aria-label={label} aria-description={`Toggle the ${label.toLowerCase()} phase for this scope.`} value={settings.sprintLoopSteps[field as keyof ProjectSettings["sprintLoopSteps"]] as boolean}
                onChange={(value) => update({
                  sprintLoopSteps: {
                    ...settings.sprintLoopSteps,
                    [field]: value,
                  },
                })}
              />
            </Row>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("Watch loop interval")} description={tr("Polling interval in seconds for the orchestration watch loop.")} badge={getBadge("sprintLoopSteps.watchLoopIntervalSeconds")}>
            <NumberInput
              value={settings.sprintLoopSteps.watchLoopIntervalSeconds}
              min={1}
              max={3600}
              onChange={(value) => update({
                sprintLoopSteps: {
                  ...settings.sprintLoopSteps,
                  watchLoopIntervalSeconds: value,
                },
              })}
            />
          </Row>
          <Row label={tr("Watch output interval")} description={tr("Maximum watch-loop runtime before the server returns progress and rerun guidance.")} badge={getBadge("sprintLoopSteps.watchLoopOutputIntervalSeconds")}>
            <NumberInput
              value={settings.sprintLoopSteps.watchLoopOutputIntervalSeconds}
              min={60}
              max={3600}
              onChange={(value) => update({
                sprintLoopSteps: {
                  ...settings.sprintLoopSteps,
                  watchLoopOutputIntervalSeconds: value,
                },
              })}
            />
          </Row>
        </div>
      </Card>

      <Card
        title={tr("CLI Workflow")}
        description={tr("Execution environment, cleanup rules, and container credential mount behavior.")}
        badge={cliSource ? sourceLabel(cliSource) : undefined}
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("Execution mode")} description={tr("Run provider CLIs on the host or inside a containerized runtime.")} badge={getBadge("cliWorkflow.executionMode")}>
            <SelectInput
              value={settings.cliWorkflow.executionMode}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  executionMode: value as ProjectSettings["cliWorkflow"]["executionMode"],
                },
              })}
              options={[
                { value: "HOST", label: "Host" },
                { value: "DOCKER", label: "Docker" },
              ]}
            />
          </Row>
          <Row label={tr("Runtime image mode")} description={tr("Use the auto-updating Code UX runtime or an explicit custom image.")} badge={getBadge("cliWorkflow.containerImageMode")}>
            <SelectInput
              value={settings.cliWorkflow.containerImageMode}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerImageMode: value === "custom" ? "custom" : "managed",
                },
              })}
              options={[
                { value: "managed", label: "Managed runtime" },
                { value: "custom", label: "Custom image" },
              ]}
            />
          </Row>
          <Row label={tr("Custom container image")} description={tr("Container image used only in custom mode.")} badge={getBadge("cliWorkflow.containerImage")}>
            <TextInput
              value={settings.cliWorkflow.containerImage}
              disabled={settings.cliWorkflow.containerImageMode !== "custom"}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerImage: value,
                },
              })}
              mono
            />
          </Row>
          <Row label={tr("Setup script path")} description={tr("Optional bootstrap script relative to the repo or runtime root.")} badge={getBadge("cliWorkflow.containerSetupScriptPath")}>
            <LocalFilePickerField
              label={tr("Setup script path")}
              value={settings.cliWorkflow.containerSetupScriptPath}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerSetupScriptPath: value,
                },
              })}
              helperText={tr("Type a relative path or browse to an absolute local script.")}
              placeholder={tr(".code-ux/container/setup.sh")}
            />
          </Row>
          <Row label={tr("Cache custom setup extension")} description={tr("Build and reuse an extension image for an explicitly configured setup script.")} badge={getBadge("cliWorkflow.containerCacheSetupScriptImage")}>
            <Toggle aria-label={tr("Cache setup as image")} aria-description={tr("Build and reuse a derived Docker image keyed by the base image and setup script contents.")} value={settings.cliWorkflow.containerCacheSetupScriptImage}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerCacheSetupScriptImage: value,
                },
              })}
            />
          </Row>
          <Row label={tr("Preload Playwright browser")} description={tr("Download the matched browser into a reusable local Docker volume for coding containers.")} badge={getBadge("cliWorkflow.containerInstallPlaywrightBrowsers")}>
            <Toggle aria-label={tr("Preload Playwright browser")} aria-description={tr("Download the matched browser into a reusable local Docker volume for coding containers.")} value={settings.cliWorkflow.containerInstallPlaywrightBrowsers}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerInstallPlaywrightBrowsers: value,
                },
              })}
            />
          </Row>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {[
            ["cleanupWorktreeOnSuccess", "Cleanup worktree on success"],
            ["cleanupWorktreeOnFailure", "Cleanup worktree on failure"],
            ["retryOnReadFileNotFound", "Retry missing file reads"],
            ["retryOnQuotaReset", "Retry after quota reset"],
            ["retryOnRateLimit", "Retry on rate limit"],
            ["resumeFailedTaskInSameWorkspace", "Resume failed tasks in same workspace"],
            ["containerMountGitConfig", "Copy local git config"],
            ["containerMountGithubAuth", "Mount GitHub auth"],
            ["containerMountGeminiAuth", "Mount Gemini auth"],
            ["containerMountCodexAuth", "Mount Codex auth"],
            ["containerMountClaudeCodeAuth", "Mount Claude Code auth"],
            ["containerMountOpenCodeAuth", "Mount OpenCode auth"],
            ["containerMountAntigravityAuth", "Mount Antigravity auth"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Enable ${label.toLowerCase()} for this scope.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <Toggle aria-label={label} aria-description={`Enable ${label.toLowerCase()} for this scope.`} value={settings.cliWorkflow[field as keyof ProjectSettings["cliWorkflow"]] as boolean}
                onChange={(value) => update({
                  cliWorkflow: {
                    ...settings.cliWorkflow,
                    [field]: value,
                  },
                })}
              />
            </Row>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("Rate limit retry delay")} description={tr("Seconds to wait before retrying a rate-limited provider call.")} badge={getBadge("cliWorkflow.rateLimitRetryDelaySeconds")}>
            <NumberInput
              value={settings.cliWorkflow.rateLimitRetryDelaySeconds}
              min={1}
              max={3600}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  rateLimitRetryDelaySeconds: value,
                },
              })}
            />
          </Row>
          <Row label={tr("Max rate limit retries")} description={tr("Maximum rate-limit retries before the invocation fails instead of requeueing again.")} badge={getBadge("cliWorkflow.maxRateLimitRetries")}>
            <NumberInput
              value={settings.cliWorkflow.maxRateLimitRetries}
              min={1}
              max={100}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  maxRateLimitRetries: value,
                },
              })}
            />
          </Row>
          <Row label={tr("Max Parsing Retries")} description={tr("Maximum number of retry attempts to extract valid JSON from noisy model responses.")} badge={getBadge("cliWorkflow.maxParsingRetries")}>
            <NumberInput
              value={settings.cliWorkflow.maxParsingRetries}
              min={0}
              max={10}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  maxParsingRetries: value,
                },
              })}
            />
          </Row>
          {[
            ["containerGithubAuthPath", "GitHub auth path"],
            ["containerGeminiAuthPath", "Gemini auth path"],
            ["containerCodexAuthPath", "Codex auth path"],
            ["containerClaudeCodeAuthPath", "Claude Code auth path"],
            ["containerOpenCodeAuthPath", "OpenCode auth path"],
            ["containerAntigravityAuthPath", "Antigravity auth path"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Runtime path mounted for ${label.toLowerCase()}.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <TextInput aria-label={label} aria-description={`Runtime path mounted for ${label.toLowerCase()}.`} value={settings.cliWorkflow[field as keyof ProjectSettings["cliWorkflow"]] as string}
                onChange={(value) => update({
                  cliWorkflow: {
                    ...settings.cliWorkflow,
                    [field]: value,
                  },
                })}
                mono
              />
            </Row>
          ))}
        </div>
      </Card>

      <Card
        title={tr("Browser Preview")}
        description={tr("Preview runtime controls, browser visibility, rebuild policy, and container limits for the in-app browser.")}
        badge={sprintPreviewSource ? sourceLabel(sprintPreviewSource) : undefined}
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {[
            ["enabled", "Preview runtime enabled"],
            ["showInAppBrowser", "Show in-app browser workspace"],
            ["autoStartOnRunningSprint", "Launch preview when sprint starts"],
            ["rebuildOnTaskCompletion", "Rebuild preview on task completion"],
            ["rebuildOnSprintCompletion", "Rebuild preview on sprint completion"],
            ["autoStopOnTerminalSprint", "Stop preview when sprint ends"],
            ["allowDockerAccess", "Allow Docker access (host-level control)"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Enable ${label.toLowerCase()} for this scope.`} badge={getBadge(`sprintPreview.${field}`)}>
              <Toggle aria-label={label} aria-description={`Enable ${label.toLowerCase()} for this scope.`} value={settings.sprintPreview[field as keyof ProjectSettings["sprintPreview"]] as boolean}
                onChange={(value) => update({
                  sprintPreview: {
                    ...settings.sprintPreview,
                    [field]: value,
                  },
                })}
              />
            </Row>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Row label={tr("Maximum active preview containers")} description={tr("Stop the oldest active previews before launching another one when this limit is exceeded.")} badge={getBadge("sprintPreview.maxConcurrentContainers")}>
            <NumberInput
              value={settings.sprintPreview.maxConcurrentContainers}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  maxConcurrentContainers: value,
                },
              })}
              min={1}
              max={100}
            />
          </Row>
          <Row label={tr("Host port range start")} description={tr("Lower bound for localhost preview port allocation.")} badge={getBadge("sprintPreview.hostPortRangeStart")}>
            <NumberInput
              value={settings.sprintPreview.hostPortRangeStart}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  hostPortRangeStart: value,
                },
              })}
              min={1}
              max={65535}
            />
          </Row>
          <Row label={tr("Host port range end")} description={tr("Upper bound for localhost preview port allocation.")} badge={getBadge("sprintPreview.hostPortRangeEnd")}>
            <NumberInput
              value={settings.sprintPreview.hostPortRangeEnd}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  hostPortRangeEnd: value,
                },
              })}
              min={1}
              max={65535}
            />
          </Row>
          <Row label={tr("Container app port")} description={tr("Published container port used by the browser proxy.")} badge={getBadge("sprintPreview.containerAppPort")}>
            <NumberInput
              value={settings.sprintPreview.containerAppPort}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  containerAppPort: value,
                },
              })}
              min={1}
              max={65535}
            />
          </Row>
          <Row label={tr("Startup script path")} description={tr("Optional project-relative browser startup override script.")} badge={getBadge("sprintPreview.startupScriptPath")}>
            <TextInput
              value={settings.sprintPreview.startupScriptPath}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  startupScriptPath: value,
                },
              })}
              mono
            />
          </Row>
          <Row label={tr("Default startup command")} description={tr("Optional command that replaces auto-detected preview startup. Per-container overrides are available in Browser.")} badge={getBadge("sprintPreview.startupCommand")}>
            <TextInput
              value={settings.sprintPreview.startupCommand ?? ""}
              onChange={(value) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  startupCommand: value,
                },
              })}
              mono
            />
          </Row>
          <Row label={tr("Default container variables")} description={tr("Environment variables injected into every preview container for this scope.")} badge={getBadge("sprintPreview.environmentVariables")}>
            <PreviewEnvironmentEditor
              variables={settings.sprintPreview.environmentVariables ?? []}
              onChange={(environmentVariables) => update({
                sprintPreview: {
                  ...settings.sprintPreview,
                  environmentVariables,
                },
              })}
              addLabel="Add default"
              valueLabel="Preview environment default value"
            />
          </Row>
        </div>
      </Card>

      <Card
        title={tr("Skills")}
        description={tr("Enable or disable installed skills available to the orchestration layer.")}
        badge={skillsSource ? sourceLabel(skillsSource) : undefined}
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {settings.skills.map((skill, index) => (
            <Row
              key={skill.name}
              label={skill.name}
              description={skill.isInternal ? "Built-in skill managed by Code UX." : "Project skill discovered from local configuration."}
              badge={getBadge("skills")}
            >
              <Toggle aria-label={`Enable ${skill.name}`}                 value={skill.enabled}
                onChange={(value) => {
                  const nextSkills = settings.skills.map((entry, entryIndex) => (
                    entryIndex === index ? { ...entry, enabled: value } : entry
                  ));
                  update({ skills: nextSkills });
                }}
              />
            </Row>
          ))}
        </div>
      </Card>
    </div>
  );
};
