import type { FunctionComponent, ComponentChildren } from "preact";
import type { ProjectSettings, SettingsValueSource, ThinkingMode } from "../../../types.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { TextInput, TextAreaInput, NumberInput, SelectInput, Toggle, Row as SharedRow } from "./SettingsFormFields.js";
import {
  getFieldSource,
  getFieldSourceLabel,
  getSectionSource,
  getProviderModelOptions,
  PROVIDER_CARD_TOKENS,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
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

const Row: FunctionComponent<{ label: string; description?: string; children: ComponentChildren; badge?: string }> = ({ label, description, children, badge }) => (
  <SharedRow label={label} description={description} badge={badge ? <OverrideBadge label={badge} /> : undefined}>
    {children}
  </SharedRow>
);





const ProviderLogo: FunctionComponent<{
  providerId: keyof ProjectSettings["aiProvider"]["providers"];
  disabled?: boolean;
}> = ({ providerId, disabled = false }) => {
  const token = PROVIDER_CARD_TOKENS[providerId];

  return (
    <div
      className={`flex h-11 w-11 items-center justify-center rounded-[1rem] border border-black/[0.08] bg-[#F9F8F4] font-display text-sm font-black tracking-[0.16em] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${disabled ? "opacity-60" : ""}`}
      aria-hidden
    >
      {token.logoLabel}
    </div>
  );
};


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
      <Card
        title="Automation"
        description="Project-level operating posture and intervention policy."
        badge={automationSource ? sourceLabel(automationSource) : undefined}
      >
        <Row label="Automation level" description="Choose whether the system runs autonomously or pauses for operator approval." badge={getBadge("automationLevel")}>
          <SelectInput
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
          <Toggle
            value={settings.automationInterventions.autoApprovePlan}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoApprovePlan: value,
              },
            })}
          />
        </Row>
        <Row label="Auto-answer clarifications" description="Use the clarification template when a task asks for routine clarification." badge={getBadge("automationInterventions.autoAnswerClarification")}>
          <Toggle
            value={settings.automationInterventions.autoAnswerClarification}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoAnswerClarification: value,
              },
            })}
          />
        </Row>
        {settings.automationInterventions.autoAnswerClarification && (
          <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getBadge("automationInterventions.autoAnswerClarificationMode")}>
            <div className="flex gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.04]">
              <button
                onClick={() => update({
                  automationInterventions: { ...settings.automationInterventions, autoAnswerClarificationMode: "TEMPLATE" },
                })}
                className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                  settings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE"
                    ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                    : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Template
              </button>
              <button
                onClick={() => update({
                  automationInterventions: { ...settings.automationInterventions, autoAnswerClarificationMode: "WORKER" },
                })}
                className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                  settings.automationInterventions.autoAnswerClarificationMode === "WORKER"
                    ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                    : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Worker
              </button>
            </div>
          </Row>
        )}
        {(!settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") && (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clarification answer template</div>
              {getBadge("automationInterventions.clarificationAnswerTemplate") ? <OverrideBadge label={getBadge("automationInterventions.clarificationAnswerTemplate")!} /> : null}
            </div>
            <TextAreaInput
              value={settings.automationInterventions.clarificationAnswerTemplate}
              onChange={(value) => update({
                automationInterventions: {
                  ...settings.automationInterventions,
                  clarificationAnswerTemplate: value,
                },
              })}
            />
          </div>
        )}
        <Row label="Auto-resume paused runs" description="Resume paused sessions automatically after a transient pause condition clears." badge={getBadge("automationInterventions.autoResumePaused")}>
          <Toggle
            value={settings.automationInterventions.autoResumePaused}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoResumePaused: value,
              },
            })}
          />
        </Row>
      </Card>

      <Card
        title="AI Models"
        description="Select the provider strategy, model mix, and worker runtime settings this scope should use."
        badge={providerSource || workerSource ? sourceLabel(providerSource === workerSource ? (providerSource || "system") : "mixed") : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Row label="Worker mode" description="Connected workers stay in listen mode. Virtual workers wake only when worker work exists, run one unit of work, then shut down." badge={getBadge("workers.executionMode")}>
            <SelectInput
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
          {virtualWorkerModeEnabled ? (
            <Row label="Virtual worker CLI" description="Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution." badge={getBadge("workers.virtualWorkerProvider")}>
              <SelectInput
                value={settings.workers.virtualWorkerProvider}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                    model: "default",
                  },
                })}
                options={[
                  { value: "gemini", label: "Gemini" },
                  { value: "codex", label: "Codex" },
                  { value: "claude-code", label: "Claude Code" },
                ]}
              />
            </Row>
          ) : null}
          {virtualWorkerModeEnabled ? (
            <Row label="Worker model" description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used." badge={getBadge("workers.model")}>
              <SelectInput
                value={settings.workers.model || "default"}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    model: value,
                  },
                })}
                options={[
                  { value: "default", label: `Default (${settings.aiProvider.providers[settings.workers.virtualWorkerProvider].model})` },
                  ...getProviderModelOptions(settings.workers.virtualWorkerProvider),
                ]}
              />
            </Row>
          ) : null}
          <Row label="Max concurrency" description="Maximum number of parallel tasks a worker can handle simultaneously." badge={getBadge("workers.maxConcurrency")}>
            <NumberInput
              value={settings.workers.maxConcurrency}
              min={1}
              max={20}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  maxConcurrency: value,
                },
              })}
            />
          </Row>
          <Row label="Dispatch timeout" description="Seconds to wait for a worker to finish a single task dispatch before timing out." badge={getBadge("workers.timeoutSeconds")}>
            <NumberInput
              value={settings.workers.timeoutSeconds}
              min={60}
              max={3600}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  timeoutSeconds: value,
                },
              })}
            />
          </Row>
        </div>

        <div className={`grid gap-4 ${settings.aiProvider.strategy === "MANUAL" ? "lg:grid-cols-2" : ""}`}>
          <Row label="Routing strategy" description="Manual pins one provider, weighted spreads work, orchestrator can make routing decisions." badge={getBadge("aiProvider.strategy")}>
            <SelectInput
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
          {settings.aiProvider.strategy === "MANUAL" ? (
            <Row label="Primary provider" description="Default provider when the strategy is manual." badge={getBadge("aiProvider.provider")}>
              <SelectInput
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
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {Object.entries(settings.aiProvider.providers).map(([providerId, provider]) => {
            const providerKey = providerId as keyof ProjectSettings["aiProvider"]["providers"];
            const supportsModelSelection = providerSupportsModelSelection(providerKey);
            const supportsThinkingMode = providerSupportsThinkingMode(providerKey);
            const modelOptions = getProviderModelOptions(providerKey);
            const cardTokens = PROVIDER_CARD_TOKENS[providerKey];

            return (
            <div
              key={providerId}
              className={`group relative overflow-hidden rounded-[1.6rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/65 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] ${provider.enabled ? "" : "opacity-60"}`}
            >
                <div aria-hidden className={`pointer-events-none absolute inset-0 ${cardTokens.glowClassName}`} />
                <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full ${cardTokens.railClassName}`} />
                <div aria-hidden className="pointer-events-none absolute -right-2 -top-3 select-none font-display text-[4.75rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.03]">
                  {cardTokens.watermark}
                </div>
                <div className="relative z-10 mb-4 flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <ProviderLogo providerId={providerKey} disabled={!provider.enabled} />
                    <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${cardTokens.badgeClassName}`}>
                        {cardTokens.badgeLabel}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{providerLabels[providerId as keyof typeof providerLabels]}</div>
                      {getBadge(`aiProvider.providers.${providerId}.enabled`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.enabled`)!} /> : null}
                    </div>
                    <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      {providerId === "jules"
                        ? "Enabled state and routing weight. Jules follows API-managed defaults for model behavior."
                        : "Model choice, weight, and thinking mode."}
                    </div>
                    </div>
                  </div>
                <Toggle
                  value={provider.enabled}
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
              {!supportsModelSelection || !supportsThinkingMode ? (
                <div className={`relative z-10 mb-3 rounded-2xl border px-4 py-3 text-xs font-medium leading-relaxed ${cardTokens.noteClassName}`}>
                  Jules API currently does not expose model selection or thinking controls, so this provider uses Jules-managed defaults.
                </div>
              ) : null}
              <div className={`relative z-10 grid gap-3 ${supportsModelSelection && supportsThinkingMode ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                {supportsModelSelection ? (
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Model</span>
                    {getBadge(`aiProvider.providers.${providerId}.model`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.model`)!} /> : null}
                  </div>
                  {modelOptions.length > 0 ? (
                    <SelectInput
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
                      options={modelOptions}
                    />
                  ) : (
                    <TextInput
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
                  )}
                </div>
                ) : null}
                {supportsThinkingMode ? (
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Thinking mode</span>
                    {getBadge(`aiProvider.providers.${providerId}.thinkingMode`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.thinkingMode`)!} /> : null}
                  </div>
                  <SelectInput
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
                ) : null}
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Weight</span>
                    {getBadge(`aiProvider.providers.${providerId}.weight`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.weight`)!} /> : null}
                  </div>
                  <NumberInput
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
          )})}
        </div>
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
          <Row label="Sprint branch scheme" description="Template used when naming sprint branches." badge={getBadge("git.sprintBranchScheme")}>
            <TextInput
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
          <Toggle
            value={settings.git.autoCreatePr}
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
            <Toggle
              value={settings.ciIntelligence[field as keyof ProjectSettings["ciIntelligence"]] as boolean}
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
              onChange={(value) => update({
                ciIntelligence: {
                  ...settings.ciIntelligence,
                  julesCiAutofixMaxRetries: value,
                },
              })}
            />
          </Row>
          <Row label="Feature PR auto-merge" description="Policy for merging feature PRs after checks and comments are satisfied." badge={getBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <SelectInput
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
            <SelectInput
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
              <Toggle
                value={settings.sprintLoopSteps[field as keyof ProjectSettings["sprintLoopSteps"]] as boolean}
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
            <Toggle
              value={settings.cliWorkflow.containerCacheSetupScriptImage}
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
            ["containerMountGitConfig", "Mount git config"],
            ["containerMountGithubAuth", "Mount GitHub auth"],
            ["containerMountGeminiAuth", "Mount Gemini auth"],
            ["containerMountCodexAuth", "Mount Codex auth"],
            ["containerMountClaudeCodeAuth", "Mount Claude Code auth"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Enable ${label.toLowerCase()} for this scope.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <Toggle
                value={settings.cliWorkflow[field as keyof ProjectSettings["cliWorkflow"]] as boolean}
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
          {[
            ["containerGithubAuthPath", "GitHub auth path"],
            ["containerGeminiAuthPath", "Gemini auth path"],
            ["containerCodexAuthPath", "Codex auth path"],
            ["containerClaudeCodeAuthPath", "Claude Code auth path"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Runtime path mounted for ${label.toLowerCase()}.`} badge={getBadge(`cliWorkflow.${field}`)}>
              <TextInput
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
        title="Sprint Browser"
        description="Preview container behavior, routing range, and startup script overrides for the in-app browser."
        badge={sprintPreviewSource ? sourceLabel(sprintPreviewSource) : undefined}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {[
            ["autoStartOnRunningSprint", "Auto-start running sprint previews"],
            ["rebuildOnTaskCompletion", "Rebuild after task completion"],
            ["rebuildOnSprintCompletion", "Rebuild after sprint completion"],
            ["autoStopOnTerminalSprint", "Auto-stop on terminal sprint"],
          ].map(([field, label]) => (
            <Row key={field} label={label} description={`Enable ${label.toLowerCase()} for this scope.`} badge={getBadge(`sprintPreview.${field}`)}>
              <Toggle
                value={settings.sprintPreview[field as keyof ProjectSettings["sprintPreview"]] as boolean}
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
              description={skill.isInternal ? "Built-in skill managed by Sprint OS." : "Project skill discovered from local configuration."}
              badge={getBadge("skills")}
            >
              <Toggle
                value={skill.enabled}
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
