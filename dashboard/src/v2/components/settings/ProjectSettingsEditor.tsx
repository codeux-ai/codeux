import type { FunctionComponent, ComponentChildren } from "preact";
import type { ProjectSettings, SettingsValueSource, ThinkingMode } from "../../../types.js";
import {
  getFieldSource,
  getFieldSourceLabel,
  getSectionSource,
  type SettingsEditorScope,
} from "../../lib/settings-view-models.js";

interface ProjectSettingsEditorProps {
  settings: ProjectSettings;
  onChange: (next: ProjectSettings) => void;
  sources?: Record<string, SettingsValueSource>;
  editingScope?: SettingsEditorScope;
}

const Card: FunctionComponent<{ title: string; description: string; badge?: string; children: ComponentChildren }> = ({
  title,
  description,
  badge,
  children,
}) => (
  <section className="rounded-[2rem] border border-black/[0.06] bg-white/72 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
      <div>
        <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {badge ? (
        <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
          {badge}
        </span>
      ) : null}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);

const OverrideBadge: FunctionComponent<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
      !
    </span>
    {label}
  </span>
);

const Row: FunctionComponent<{ label: string; description: string; children: ComponentChildren; badge?: string }> = ({
  label,
  description,
  children,
  badge,
}) => (
  <div className="flex flex-col gap-3 rounded-[1.35rem] border border-black/[0.05] bg-black/[0.015] px-4 py-4 dark:border-white/[0.05] dark:bg-white/[0.02] lg:flex-row lg:items-center lg:justify-between">
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
        {badge ? <OverrideBadge label={badge} /> : null}
      </div>
      <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
    </div>
    <div className="flex shrink-0 items-center gap-3">{children}</div>
  </div>
);

const TextField: FunctionComponent<{ value: string; onChange: (value: string) => void; mono?: boolean }> = ({ value, onChange, mono }) => (
  <input
    type="text"
    value={value}
    onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
    className={`h-11 rounded-xl border border-black/[0.08] bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-200 ${mono ? "font-mono" : ""}`}
  />
);

const TextAreaField: FunctionComponent<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => (
  <textarea
    value={value}
    onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
    className="min-h-[112px] w-full rounded-2xl border border-black/[0.08] bg-white px-3 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-200"
  />
);

const NumberField: FunctionComponent<{ value: number; onChange: (value: number) => void; min?: number; max?: number }> = ({
  value,
  onChange,
  min,
  max,
}) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
    className="h-11 w-28 rounded-xl border border-black/[0.08] bg-white px-3 font-mono text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-200"
  />
);

const SelectField: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
    className="h-11 rounded-xl border border-black/[0.08] bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-200"
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>{option.label}</option>
    ))}
  </select>
);

const ToggleField: FunctionComponent<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-700"}`}
  >
    <span
      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
    />
  </button>
);

const sourceLabel = (source: SettingsValueSource | "mixed"): string => {
  switch (source) {
    case "project":
      return "Project override";
    case "sprint":
      return "Sprint override";
    case "mixed":
      return "Mixed sources";
    case "system":
    default:
      return "Inherited";
  }
};

const thinkingModeOptions: Array<{ value: ThinkingMode; label: string }> = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const providerLabels: Record<keyof ProjectSettings["aiProvider"]["providers"], string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
};

export const ProjectSettingsEditor: FunctionComponent<ProjectSettingsEditorProps> = ({
  settings,
  onChange,
  sources,
  editingScope = "project",
}) => {
  const update = (patch: Partial<ProjectSettings>) => onChange({ ...settings, ...patch });
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
  const workerSource = sources ? getSectionSource(sources, "workers") : undefined;
  const skillsSource = sources ? getSectionSource(sources, "skills") : undefined;

  return (
    <div className="space-y-6">
      <Card
        title="Automation"
        description="Project-level operating posture and intervention policy."
        badge={automationSource ? sourceLabel(automationSource) : undefined}
      >
        <Row label="Automation level" description="Choose whether the system runs autonomously or pauses for operator approval." badge={getBadge("automationLevel")}>
          <SelectField
            value={settings.automationLevel}
            onChange={(value) => update({ automationLevel: value as ProjectSettings["automationLevel"] })}
            options={[
              { value: "FULL", label: "Full" },
              { value: "SEMI_AUTO", label: "Semi-auto" },
              { value: "ALWAYS_ASK", label: "Always ask" },
            ]}
          />
        </Row>
        <Row label="Auto-approve plans" description="Approve planning checkpoints automatically when the sprint asks for plan confirmation." badge={getBadge("automationInterventions.autoApprovePlan")}>
          <ToggleField
            checked={settings.automationInterventions.autoApprovePlan}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoApprovePlan: value,
              },
            })}
          />
        </Row>
        <Row label="Auto-answer clarifications" description="Use the clarification template when a task asks for routine clarification." badge={getBadge("automationInterventions.autoAnswerClarification")}>
          <ToggleField
            checked={settings.automationInterventions.autoAnswerClarification}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoAnswerClarification: value,
              },
            })}
          />
        </Row>
        <Row label="Auto-resume paused runs" description="Resume paused sessions automatically after a transient pause condition clears." badge={getBadge("automationInterventions.autoResumePaused")}>
          <ToggleField
            checked={settings.automationInterventions.autoResumePaused}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoResumePaused: value,
              },
            })}
          />
        </Row>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clarification answer template</div>
            {getBadge("automationInterventions.clarificationAnswerTemplate") ? <OverrideBadge label={getBadge("automationInterventions.clarificationAnswerTemplate")!} /> : null}
          </div>
          <TextAreaField
            value={settings.automationInterventions.clarificationAnswerTemplate}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                clarificationAnswerTemplate: value,
              },
            })}
          />
        </div>
      </Card>

      <Card
        title="Provider Routing"
        description="Select the provider strategy and model mix this scope should use."
        badge={providerSource ? sourceLabel(providerSource) : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Primary provider" description="Default provider when the strategy is manual." badge={getBadge("aiProvider.provider")}>
            <SelectField
              value={settings.aiProvider.provider}
              onChange={(value) => update({
                aiProvider: {
                  ...settings.aiProvider,
                  provider: value as ProjectSettings["aiProvider"]["provider"],
                },
              })}
              options={[
                { value: "jules", label: "Jules" },
                { value: "gemini", label: "Gemini" },
                { value: "codex", label: "Codex" },
                { value: "claude-code", label: "Claude Code" },
              ]}
            />
          </Row>
          <Row label="Routing strategy" description="Manual pins one provider, weighted spreads work, orchestrator can make routing decisions." badge={getBadge("aiProvider.strategy")}>
            <SelectField
              value={settings.aiProvider.strategy}
              onChange={(value) => update({
                aiProvider: {
                  ...settings.aiProvider,
                  strategy: value as ProjectSettings["aiProvider"]["strategy"],
                },
              })}
              options={[
                { value: "MANUAL", label: "Manual" },
                { value: "WEIGHTED", label: "Weighted" },
                { value: "ORCHESTRATOR", label: "Orchestrator" },
              ]}
            />
          </Row>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Object.entries(settings.aiProvider.providers).map(([providerId, provider]) => (
            <div
              key={providerId}
              className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]"
            >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{providerLabels[providerId as keyof typeof providerLabels]}</div>
                      {getBadge(`aiProvider.providers.${providerId}.enabled`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.enabled`)!} /> : null}
                    </div>
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Model choice, weight, and thinking mode.</div>
                  </div>
                <ToggleField
                  checked={provider.enabled}
                  onChange={(value) => update({
                    aiProvider: {
                      ...settings.aiProvider,
                      providers: {
                        ...settings.aiProvider.providers,
                        [providerId]: {
                          ...provider,
                          enabled: value,
                        },
                      },
                    },
                  })}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Model</span>
                    {getBadge(`aiProvider.providers.${providerId}.model`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.model`)!} /> : null}
                  </div>
                  <TextField
                    value={provider.model}
                    onChange={(value) => update({
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [providerId]: {
                            ...provider,
                            model: value,
                          },
                        },
                      },
                    })}
                    mono
                  />
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Thinking mode</span>
                    {getBadge(`aiProvider.providers.${providerId}.thinkingMode`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.thinkingMode`)!} /> : null}
                  </div>
                  <SelectField
                    value={provider.thinkingMode}
                    onChange={(value) => update({
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [providerId]: {
                            ...provider,
                            thinkingMode: value as ThinkingMode,
                          },
                        },
                      },
                    })}
                    options={thinkingModeOptions}
                  />
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Weight</span>
                    {getBadge(`aiProvider.providers.${providerId}.weight`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.weight`)!} /> : null}
                  </div>
                  <NumberField
                    value={provider.weight}
                    min={0}
                    max={100}
                    onChange={(value) => update({
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [providerId]: {
                            ...provider,
                            weight: value,
                          },
                        },
                      },
                    })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Git Flow"
        description="Branching and PR behavior for orchestrated work."
        badge={gitSource ? sourceLabel(gitSource) : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="GitHub mode" description="Local disables PR intelligence, remote enables PR and CI awareness." badge={getBadge("git.githubMode")}>
            <SelectField
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
            <TextField
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
            <TextField
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
          <Row label="Sprint branch scheme" description="Template used when naming sprint branches." badge={getBadge("git.sprintBranchScheme")}>
            <TextField
              value={settings.git.sprintBranchScheme}
              onChange={(value) => update({
                git: {
                  ...settings.git,
                  sprintBranchScheme: value,
                },
              })}
              mono
            />
          </Row>
        </div>
        <Row label="Auto-create PRs" description="Open pull requests automatically for remote git workflows." badge={getBadge("git.autoCreatePr")}>
          <ToggleField
            checked={settings.git.autoCreatePr}
            onChange={(value) => update({
              git: {
                ...settings.git,
                autoCreatePr: value,
              },
            })}
          />
        </Row>
      </Card>

      <Card
        title="CI Intelligence"
        description="Controls how aggressively the sprint loop waits on checks, comments, and autofix behavior."
        badge={ciSource ? sourceLabel(ciSource) : undefined}
      >
        {[
          ["enabled", "Enable CI intelligence", "Turn CI and PR gate reasoning on for this scope."],
          ["enableLivePrMonitoring", "Live PR monitoring", "Track PR and CI updates while runs are active."],
          ["waitForCiBeforeMainMerge", "Wait before main merge", "Hold main branch merges until required checks finish."],
          ["resolveAllCommentsBeforeMainMerge", "Resolve comments before main merge", "Require review comment resolution before main branch merge."],
          ["resolveMainMergeConflicts", "Resolve main merge conflicts", "Escalate main-branch merge conflicts to the connected worker with branch and sprint context."],
          ["waitForCiBeforeFeatureMerge", "Wait before feature merge", "Hold feature branch merge until checks finish."],
          ["resolveAllCommentsBeforeFeatureMerge", "Resolve comments before feature merge", "Require review comment resolution before feature branch merge."],
          ["resolveMergeConflicts", "Resolve feature merge conflicts", "Escalate feature-branch merge conflicts to the connected worker with branch and prompt context."],
          ["waitForJulesCiAutofix", "Wait for Jules autofix", "Allow Jules to attempt CI autofix before escalating."],
        ].map(([field, label, description]) => (
          <Row key={field} label={label} description={description} badge={getBadge(`ciIntelligence.${field}`)}>
            <ToggleField
              checked={settings.ciIntelligence[field as keyof ProjectSettings["ciIntelligence"]] as boolean}
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
            <NumberField
              value={settings.ciIntelligence.julesCiAutofixMaxRetries}
              min={0}
              max={20}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  julesCiAutofixMaxRetries: value,
                },
              })}
            />
          </Row>
          <Row label="Feature PR auto-merge" description="Policy for merging feature PRs after checks and comments are satisfied." badge={getBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <SelectField
              value={settings.ciIntelligence.featurePrAutoMergeMode}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  featurePrAutoMergeMode: value as ProjectSettings["ciIntelligence"]["featurePrAutoMergeMode"],
                },
              })}
              options={[
                { value: "OFF", label: "Off" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
          <Row label="Main branch auto-merge" description="Policy for merging the main branch PR after checks and comments are satisfied." badge={getBadge("ciIntelligence.mainBranchAutoMergeMode")}>
            <SelectField
              value={settings.ciIntelligence.mainBranchAutoMergeMode}
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  mainBranchAutoMergeMode: value as ProjectSettings["ciIntelligence"]["mainBranchAutoMergeMode"],
                },
              })}
              options={[
                { value: "OFF", label: "Off" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
        </div>
      </Card>

      <Card
        title="Workers"
        description="Select whether worker-owned execution is handled by connected MCP workers or a short-lived virtual CLI worker."
        badge={workerSource ? sourceLabel(workerSource) : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Worker mode" description="Connected workers stay in listen mode. Virtual workers wake only when worker work exists, run one unit of work, then shut down." badge={getBadge("workers.executionMode")}>
            <SelectField
              value={settings.workers.executionMode}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  executionMode: value as ProjectSettings["workers"]["executionMode"],
                },
              })}
              options={[
                { value: "CONNECTED_MCP", label: "Connected MCP" },
                { value: "VIRTUAL", label: "Virtual on-demand" },
              ]}
            />
          </Row>
          <Row label="Virtual worker CLI" description="Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution." badge={getBadge("workers.virtualWorkerProvider")}>
            <SelectField
              value={settings.workers.virtualWorkerProvider}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                },
              })}
              options={[
                { value: "gemini", label: "Gemini" },
                { value: "codex", label: "Codex" },
                { value: "claude-code", label: "Claude Code" },
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
              <ToggleField
                checked={settings.sprintLoopSteps[field as keyof ProjectSettings["sprintLoopSteps"]] as boolean}
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
            <NumberField
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
            <NumberField
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
            <SelectField
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
            <TextField
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
            <TextField
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
            <ToggleField
              checked={settings.cliWorkflow.containerCacheSetupScriptImage}
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
            ["resumeFailedTaskInSameWorkspace", "Resume failed tasks in same workspace"],
            ["containerMountGitConfig", "Mount git config"],
            ["containerMountGithubAuth", "Mount GitHub auth"],
            ["containerMountGeminiAuth", "Mount Gemini auth"],
            ["containerMountCodexAuth", "Mount Codex auth"],
            ["containerMountClaudeCodeAuth", "Mount Claude Code auth"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Enable ${label.toLowerCase()} for this scope.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <ToggleField
                checked={settings.cliWorkflow[field as keyof ProjectSettings["cliWorkflow"]] as boolean}
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
          {[
            ["containerGithubAuthPath", "GitHub auth path"],
            ["containerGeminiAuthPath", "Gemini auth path"],
            ["containerCodexAuthPath", "Codex auth path"],
            ["containerClaudeCodeAuthPath", "Claude Code auth path"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Runtime path mounted for ${label.toLowerCase()}.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <TextField
                value={settings.cliWorkflow[field as keyof ProjectSettings["cliWorkflow"]] as string}
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
        title="Skills"
        description="Enable or disable installed skills available to the orchestration layer."
        badge={skillsSource ? sourceLabel(skillsSource) : undefined}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {settings.skills.map((skill, index) => (
            <Row
              key={skill.name}
              label={skill.name}
              description={skill.isInternal ? "Built-in skill managed by Sprint OS." : "Project skill discovered from local configuration."}
              badge={getBadge("skills")}
            >
              <ToggleField
                checked={skill.enabled}
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
