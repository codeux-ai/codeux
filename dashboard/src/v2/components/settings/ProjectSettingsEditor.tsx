import type { FunctionComponent, ComponentChildren } from "preact";
import type { ProjectSettings, SettingsValueSource, ThinkingMode } from "../../../types.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { TextInput, TextAreaInput, NumberInput, SelectInput, Toggle } from "./SettingsFormFields.js";
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
import { Card, OverrideBadge, Row } from "./panels/SharedPanelComponents.js";
import { AutomationPanel } from "./panels/AutomationPanel.js";
import { ProviderPanel } from "./panels/ProviderPanel.js";
import { WorkerPanel } from "./panels/WorkerPanel.js";
import { InfoIconPopover } from "../ui/InfoIconPopover.js";
import { BranchNameSchemeEditor } from "./BranchNameSchemeEditor.js";


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
  const update = (patch: Partial<ProjectSettings>) => onChange({ ...settings, ...patch });
  const virtualWorkerModeEnabled = settings.workers.executionMode === "VIRTUAL";
  const getBadge = (path: string): string | undefined => {
    if (!sources) {
      return undefined;
    }
    return getFieldSourceLabel(getFieldSource(sources, path), editingScope) ?? undefined;
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
        title="AI Models"
        description="Set provider defaults, invocation routing, model mix, and worker runtime settings this scope should use."
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
        title="Git Flow"
        description="Branching and PR behavior for orchestrated work."
        badge={gitSource ? sourceLabel(gitSource) : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="GitHub mode" description="Local disables PR intelligence, remote enables PR and CI awareness." badge={getBadge("git.githubMode")}>
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
          <Row label="Default branch" description="Base branch used for sprint creation and merge targets." badge={getBadge("git.defaultBranch")}>
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
          <Row label="Feature branch prefix" description="Prefix used when feature branches are generated automatically." badge={getBadge("git.featureBranchPrefix")}>
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
          <Row label="Sprint branch scheme" description="Template used when naming sprint branches." badge={getBadge("git.sprintBranchScheme")} info={<InfoIconPopover items={[
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

        </div>
        <Row label="Auto-create PRs" description={settings.git.githubMode === "LOCAL" ? "Open pull requests automatically for remote git workflows. (Disabled in Local mode)" : "Open pull requests automatically for remote git workflows."} badge={getBadge("git.autoCreatePr")}>
          <Toggle aria-label="Auto-create PRs" aria-description={settings.git.githubMode === "LOCAL" ? "Open pull requests automatically for remote git workflows. (Disabled in Local mode)" : "Open pull requests automatically for remote git workflows."} value={settings.git.githubMode === "LOCAL" ? false : settings.git.autoCreatePr}
            disabled={settings.git.githubMode === "LOCAL"}
            onChange={(value) => update({
              git: {
                ...settings.git,
                autoCreatePr: value,
              },
            })}
          />
        </Row>
        <Row label="Auto-close linked issues" description={settings.git.githubMode === "LOCAL" ? "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete. (Disabled in Local mode)" : "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete."} badge={getBadge("git.autoCloseLinkedIssues")}>
          <Toggle aria-label="Auto-close linked issues" aria-description={settings.git.githubMode === "LOCAL" ? "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete. (Disabled in Local mode)" : "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete."} value={settings.git.githubMode === "LOCAL" ? false : settings.git.autoCloseLinkedIssues}
            disabled={settings.git.githubMode === "LOCAL"}
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
        title={settings.git.githubMode === "LOCAL" ? "CI Intelligence (Unavailable in Local Mode)" : "CI Intelligence"}
        description={settings.git.githubMode === "LOCAL" ? "Controls how aggressively the sprint loop waits on checks, comments, and autofix behavior. (Disabled in Local mode)" : "Controls how aggressively the sprint loop waits on checks, comments, and autofix behavior."}
        badge={settings.git.githubMode === "LOCAL" ? "Disabled in Local Mode" : (ciSource ? sourceLabel(ciSource) : undefined)}
      >
        {[
          ["enabled", "Enable CI intelligence", "Turn CI and PR gate reasoning on for this scope."],
          ["enableLivePrMonitoring", "Live PR monitoring", "Track PR and CI updates while runs are active."],
          ["resolveAllCommentsBeforeMainMerge", "Resolve comments before main merge", "Require review comment resolution before main branch merge."],
          ["resolveMainMergeConflicts", "Resolve main merge conflicts", "Escalate main-branch merge conflicts to the virtual worker with branch and sprint context."],
          ["resolveMainMergeFailedChecks", "Fix main merge CI failures", "Dispatch the virtual worker to fix failing CI on the main-branch merge gate before escalating to a human."],
          ["resolveAllCommentsBeforeFeatureMerge", "Resolve comments before feature merge", "Require review comment resolution before feature branch merge."],
          ["resolveMergeConflicts", "Resolve feature merge conflicts", "Escalate feature-branch merge conflicts to the virtual worker with branch and prompt context."],
          ["waitForJulesCiAutofix", "Wait for Jules autofix", "Allow Jules to attempt CI autofix before escalating."],
        ].map(([field, label, description]) => (
          <Row key={field} label={label} description={description} badge={getBadge(`ciIntelligence.${field}`)}>
            <Toggle aria-label={label} aria-description={description} value={settings.git.githubMode === "LOCAL" ? false : (settings.ciIntelligence[field as keyof ProjectSettings["ciIntelligence"]] as boolean)}
              disabled={settings.git.githubMode === "LOCAL"}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  [field]: value,
                },
              })}
            />
          </Row>
        ))}
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Autofix max retries" description="Maximum retries before CI autofix escalates to supervision." badge={getBadge("ciIntelligence.julesCiAutofixMaxRetries")}>
            <NumberInput
              value={settings.ciIntelligence.julesCiAutofixMaxRetries}
              min={0}
              max={20}
              disabled={settings.git.githubMode === "LOCAL"}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  julesCiAutofixMaxRetries: value,
                },
              })}
            />
          </Row>
          <Row label="Feature PR auto-merge" description="Policy for leaving feature work at PR creation or merging after checks and comments are satisfied." badge={getBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <SelectInput
              value={settings.git.githubMode === "LOCAL" ? "OFF" : settings.ciIntelligence.featurePrAutoMergeMode}
              disabled={settings.git.githubMode === "LOCAL"}
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
          <Row label="Main branch auto-merge" description="Policy for leaving the final main PR at creation or merging it after checks and comments are satisfied." badge={getBadge("ciIntelligence.mainBranchAutoMergeMode")}>
            <SelectInput
              value={settings.git.githubMode === "LOCAL" ? "OFF" : settings.ciIntelligence.mainBranchAutoMergeMode}
              disabled={settings.git.githubMode === "LOCAL"}
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
        title="Sprint Loop"
        description="Enable or disable orchestration phases and tune watch-loop timing."
        badge={loopSource ? sourceLabel(loopSource) : undefined}
      >
        <div className="grid gap-3 xl:grid-cols-2">
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Watch loop interval" description="Polling interval in seconds for the orchestration watch loop." badge={getBadge("sprintLoopSteps.watchLoopIntervalSeconds")}>
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
          <Row label="Watch output interval" description="Maximum watch-loop runtime before the server returns progress and rerun guidance." badge={getBadge("sprintLoopSteps.watchLoopOutputIntervalSeconds")}>
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
        title="CLI Workflow"
        description="Execution environment, cleanup rules, and container credential mount behavior."
        badge={cliSource ? sourceLabel(cliSource) : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Execution mode" description="Run provider CLIs on the host or inside a containerized runtime." badge={getBadge("cliWorkflow.executionMode")}>
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
          <Row label="Container image" description="Container image used when execution mode is Docker." badge={getBadge("cliWorkflow.containerImage")}>
            <TextInput
              value={settings.cliWorkflow.containerImage}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerImage: value,
                },
              })}
              mono
            />
          </Row>
          <Row label="Setup script path" description="Optional bootstrap script relative to the repo or runtime root." badge={getBadge("cliWorkflow.containerSetupScriptPath")}>
            <TextInput
              value={settings.cliWorkflow.containerSetupScriptPath}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerSetupScriptPath: value,
                },
              })}
              mono
            />
          </Row>
          <Row label="Cache setup as image" description="Build and reuse a derived Docker image keyed by the base image and setup script contents." badge={getBadge("cliWorkflow.containerCacheSetupScriptImage")}>
            <Toggle aria-label="Cache setup as image" aria-description="Build and reuse a derived Docker image keyed by the base image and setup script contents." value={settings.cliWorkflow.containerCacheSetupScriptImage}
              onChange={(value) => update({
                cliWorkflow: {
                  ...settings.cliWorkflow,
                  containerCacheSetupScriptImage: value,
                },
              })}
            />
          </Row>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Rate limit retry delay" description="Seconds to wait before retrying a rate-limited provider call." badge={getBadge("cliWorkflow.rateLimitRetryDelaySeconds")}>
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
          <Row label="Max rate limit retries" description="Maximum rate-limit retries before the invocation fails instead of requeueing again." badge={getBadge("cliWorkflow.maxRateLimitRetries")}>
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
          <Row label="Max Parsing Retries" description="Maximum number of retry attempts to extract valid JSON from noisy model responses." badge={getBadge("cliWorkflow.maxParsingRetries")}>
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
        title="Browser Preview"
        description="Preview runtime controls, browser visibility, rebuild policy, and container limits for the in-app browser."
        badge={sprintPreviewSource ? sourceLabel(sprintPreviewSource) : undefined}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {[
            ["enabled", "Preview runtime enabled"],
            ["showInAppBrowser", "Show in-app browser workspace"],
            ["autoStartOnRunningSprint", "Launch preview when sprint starts"],
            ["rebuildOnTaskCompletion", "Rebuild preview on task completion"],
            ["rebuildOnSprintCompletion", "Rebuild preview on sprint completion"],
            ["autoStopOnTerminalSprint", "Stop preview when sprint ends"],
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Maximum active preview containers" description="Stop the oldest active previews before launching another one when this limit is exceeded." badge={getBadge("sprintPreview.maxConcurrentContainers")}>
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
          <Row label="Host port range start" description="Lower bound for localhost preview port allocation." badge={getBadge("sprintPreview.hostPortRangeStart")}>
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
          <Row label="Host port range end" description="Upper bound for localhost preview port allocation." badge={getBadge("sprintPreview.hostPortRangeEnd")}>
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
          <Row label="Container app port" description="Published container port used by the browser proxy." badge={getBadge("sprintPreview.containerAppPort")}>
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
          <Row label="Startup script path" description="Optional project-relative browser startup override script." badge={getBadge("sprintPreview.startupScriptPath")}>
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
        </div>
      </Card>

      <Card
        title="Skills"
        description="Enable or disable installed skills available to the orchestration layer."
        badge={skillsSource ? sourceLabel(skillsSource) : undefined}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {settings.skills.map((skill, index) => (
            <Row
              key={skill.name}
              label={skill.name}
              description={skill.isInternal ? "Built-in skill managed by Code UX." : "Project skill discovered from local configuration."}
              badge={getBadge("skills")}
            >
              <Toggle aria-label="Toggle setting"                 value={skill.enabled}
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
