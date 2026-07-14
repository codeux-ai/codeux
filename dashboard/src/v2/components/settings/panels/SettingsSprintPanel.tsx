import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings, GuardrailJobType, GuardrailOnLimitAction } from "../../../../types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { QAPanel } from "./QAPanel.js";
import { Eye, GitBranch, GitMerge, GitPullRequest, PlayCircle, ShieldAlert, Sparkles, Timer } from "lucide-preact";
import { AgentSelectAvatarIcon } from "../../agents/AgentSelectAvatarIcon.js";
import { SprintKeyEditor } from "../SprintKeyEditor.js";
import { InfoIconPopover } from "../../ui/InfoIconPopover.js";
import { BranchNameSchemeEditor, TaskPrTitleSchemeEditor } from "../BranchNameSchemeEditor.js";
import { PrTemplateEditorModal } from "../PrTemplateEditorModal.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";
import { updateGitHubModeForSettings } from "../../../../lib/settings-updaters.js";
import { getSettingsOperationsNumberError, useSettingsOperationsTranslations, type SettingsOperationsTranslate } from "../../../i18n/messages/settings-operations.js";

const getGuardrailJobMeta = (t: SettingsOperationsTranslate): Array<{ key: GuardrailJobType; label: string; description: string }> => [
  { key: "task_coding", label: t("Coding attempts"), description: t("Max times a task is (re)dispatched for coding before it is blocked.") },
  { key: "ci_fix", label: t("CI autofix attempts"), description: t("Max CI autofix attempts (Jules notify or worker) per task.") },
  { key: "merge_conflict", label: t("Merge conflict resolutions"), description: t("Max merge-conflict resolution attempts per task.") },
  { key: "clarification_reply", label: t("Clarification auto-answers"), description: t("Max automatic clarification replies before waiting for a human.") },
  { key: "planning", label: t("Planning runs"), description: t("Max planning invocations attributed to a single task.") },
  { key: "remediation", label: t("Remediation runs"), description: t("Max memory remediation invocations per sprint or scheduled long-term cleanup.") },
];

const getGuardrailActionOptions = (t: SettingsOperationsTranslate): Array<{ value: GuardrailOnLimitAction; label: string; hint: string }> => [
  { value: "BLOCK_AND_ESCALATE", label: t("Block + escalate"), hint: t("Block the task and hand it to a human.") },
  { value: "STOP_AND_WAIT", label: t("Stop + wait"), hint: t("Stop auto-handling and wait for a human.") },
  { value: "WARN_ONLY", label: t("Warn only"), hint: t("Log a warning but keep going.") },
];

export const SettingsSprintPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { t } = useSettingsOperationsTranslations();
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    projectAgentPresetOptions,
    updateProject,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);
  const [editingPrTemplate, setEditingPrTemplate] = useState<"task" | "sprint" | null>(null);
  const guardrailJobMeta = getGuardrailJobMeta(t);
  const guardrailActionOptions = getGuardrailActionOptions(t);
  const getAutoMergeModeLabel = (value: ProjectSettings["ciIntelligence"]["featurePrAutoMergeMode"]): string => (
    value === "OFF" ? t("Off") : value === "CREATE_PR" ? t("Create PR") : value === "WHEN_GREEN" ? t("When green") : t("Always")
  );

  if (!editableSettings) {
    return null;
  }

  const qaSettings = projectSettings?.agents.qualityAssurance ?? editableSettings.agents.qualityAssurance;
  const qaSelfReflectionSettings = projectSettings?.agents.selfReflection?.qualityAssurance
    ?? editableSettings.agents.selfReflection?.qualityAssurance
    ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance;
  const projectAgentSelectOptions = projectAgentPresetOptions.map((option) => ({
    ...option,
    icon: () => <AgentSelectAvatarIcon avatarConfig={option.avatarConfig} seed={`${option.value}:${option.label}`} />,
  }));
  const qaPresetOptions = projectAgentSelectOptions;
  const qaPresetSelectorsDisabled = !selectedProject || !projectSettings;
  const qaSectionBadge = selectedProject
    ? getBadgeHelper("project", projectSources, "agents", "agents.qualityAssurance")
    : getBadge("agents", "agents.qualityAssurance");
  const qaFieldBadge = (path: string) => (
    selectedProject
      ? getFieldBadgeHelper("project", projectSources, path)
      : getFieldBadge(path)
  );

  const updateQaSettings = (recipe: (current: typeof qaSettings) => typeof qaSettings): void => {
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

  const updateQaSelfReflectionSettings = (recipe: (current: typeof qaSelfReflectionSettings) => typeof qaSelfReflectionSettings): void => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          selfReflection: {
            ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
            qualityAssurance: recipe(current.agents.selfReflection?.qualityAssurance ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance),
          },
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        selfReflection: {
          ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
          qualityAssurance: recipe(current.agents.selfReflection?.qualityAssurance ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance),
        },
      },
    }));
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard
        title={t("Git Flow")}
        watermark="GIT"
        badge={getBadge("git")}
        icon={<GitBranch strokeWidth={2.4} />}
        highlights={[
          { label: t("Mode"), value: editableSettings.git.githubMode === "LOCAL" ? t("Local") : t("Remote"), tone: "active" },
          { label: t("Default branch"), value: editableSettings.git.defaultBranch },
          { label: t("Pull requests"), value: editableSettings.git.githubMode === "LOCAL" ? t("Unavailable") : editableSettings.git.autoCreatePr ? t("Automatic") : t("Manual") },
        ]}
        actions={
          <>
            <button
              type="button"
              onClick={() => setEditingPrTemplate("task")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:bg-black/[0.04] dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.06]"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {t("Customize Task PR…")}
            </button>
            <button
              type="button"
              onClick={() => setEditingPrTemplate("sprint")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:bg-black/[0.04] dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.06]"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {t("Customize Sprint PR…")}
            </button>
          </>
        }
      >
        <Row label={t("Git mode")} description={t("Remote enables PR and CI-aware automation. Local keeps orchestration repo-local only.")} badge={getFieldBadge("git.githubMode")}>
          <PillChoiceGroup
            value={editableSettings.git.githubMode}
            onChange={(value) => updateEditableSettings((current) => updateGitHubModeForSettings(
              current,
              value as ProjectSettings["git"]["githubMode"],
            ))}
            options={[
              { value: "REMOTE", label: t("Remote"), hint: t("PRs, CI, and remote branch sync stay enabled.") },
              { value: "LOCAL", label: t("Local"), hint: t("Disable remote PR orchestration and stay repo-local.") },
            ]}
          />
        </Row>
        <Row label={t("Default branch")} description={t("Base branch used for sprint branch creation and merge targets.")} badge={getFieldBadge("git.defaultBranch")}>
          <TextInput
            value={editableSettings.git.defaultBranch}
            aria-label={t("Default branch")}
            aria-description={t("Base branch used for sprint branch creation and merge targets.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                defaultBranch: value,
              },
            }))}
            mono
          />
        </Row>
        <Row label={t("Feature branch prefix")} description={t("Prefix used when worker feature branches are generated automatically.")} badge={getFieldBadge("git.featureBranchPrefix")}>
          <TextInput
            value={editableSettings.git.featureBranchPrefix}
            aria-label={t("Feature branch prefix")}
            aria-description={t("Prefix used when worker feature branches are generated automatically.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                featureBranchPrefix: value,
              },
            }))}
            mono
          />
        </Row>
        <SprintKeyEditor
          value={editableSettings.git.sprintKeyPrefix}
          onChange={(value) => updateEditableSettings((current) => ({
            ...current,
            git: {
              ...current.git,
              sprintKeyPrefix: value,
            },
          }))}
          badge={getFieldBadge("git.sprintKeyPrefix")}
        />
        <Row
          label={t("Branch name scheme")}
          description={t("Template used when naming sprint branches.")}
          badge={getFieldBadge("git.sprintBranchScheme")}
          info={<InfoIconPopover items={[
            { key: "{sprint_key_prefix}", desc: t("Sprint Key Prefix") },
            { key: "{sprint_number}", desc: t("Sprint Number") },
            { key: "{sprint_name}", desc: t("Sprint Name") },
            { key: "{sprint_id}", desc: t("Sprint ID") },
            { key: "{planning_agent}", desc: t("Planning Agent") },
            { key: "{agent_routing}", desc: t("Agent Routing") },
            { key: "{worker_agent}", desc: t("Worker Agent") },
            { key: "{worker_provider}", desc: t("Worker Provider") },
            { key: "{worker_model}", desc: t("Worker Model") },
          ]} />}
        >
          <BranchNameSchemeEditor
            value={editableSettings.git.sprintBranchScheme}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                sprintBranchScheme: value,
              },
            }))}
          />
        </Row>
        <Row
          label={t("Task PR title scheme")}
          description={t("Template used when naming automatically-created task pull requests.")}
          badge={getFieldBadge("git.taskPrTitleScheme")}
        >
          <TaskPrTitleSchemeEditor
            value={editableSettings.git.taskPrTitleScheme}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                taskPrTitleScheme: value,
              },
            }))}
          />
        </Row>

        <Row label={t("Auto-create PRs")} description={editableSettings.git.githubMode === "LOCAL" ? t("Open pull requests automatically for remote git workflows. (Disabled in Local mode)") : t("Open pull requests automatically for remote git workflows.")} badge={getFieldBadge("git.autoCreatePr")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.git.autoCreatePr}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                autoCreatePr: !current.git.autoCreatePr,
              },
            }))}
          />
        </Row>
        <Row label={t("Auto-close linked issues")} description={editableSettings.git.githubMode === "LOCAL" ? t("Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete. (Disabled in Local mode)") : t("Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete.")} badge={getFieldBadge("git.autoCloseLinkedIssues")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.git.autoCloseLinkedIssues}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                autoCloseLinkedIssues: !current.git.autoCloseLinkedIssues,
              },
            }))}
          />
        </Row>
        <Row label={t("Delete merged branches")} description={t("Delete a worker branch after it merges into the sprint feature branch, and the feature branch after it merges into the default branch, so finished work doesn't leave dead branches behind. (Remote PR merges always delete the branch.)")} badge={getFieldBadge("git.deleteMergedBranches")} last>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.deleteMergedBranches}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                deleteMergedBranches: !current.git.deleteMergedBranches,
              },
            }))}
          />
        </Row>
      </SectionCard>

      <SectionCard
        title={editableSettings.git.githubMode === "LOCAL" ? t("Merge Gates & Autofix (Unavailable in Local Mode)") : t("Merge Gates & Autofix")}
        sectionId="merge-gates-autofix"
        watermark="CI"
        badge={editableSettings.git.githubMode === "LOCAL" ? t("Disabled in Local Mode") : getBadge("ciIntelligence")}
        icon={<GitMerge strokeWidth={2.4} />}
        highlights={[
          { label: t("Availability"), value: editableSettings.git.githubMode === "LOCAL" ? t("Local mode") : t("Active"), tone: editableSettings.git.githubMode === "LOCAL" ? "warning" : "active" },
          { label: t("Feature merge"), value: editableSettings.git.githubMode === "LOCAL" ? t("Off") : getAutoMergeModeLabel(editableSettings.ciIntelligence.featurePrAutoMergeMode) },
          { label: t("Main merge"), value: editableSettings.git.githubMode === "LOCAL" ? t("Off") : getAutoMergeModeLabel(editableSettings.ciIntelligence.mainBranchAutoMergeMode) },
        ]}
      >
        <Row label={t("Resolve comments before main merge")} description={t("Require review comments to be resolved before finishing the main merge.")} badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeMainMerge")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveAllCommentsBeforeMainMerge}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                resolveAllCommentsBeforeMainMerge: !current.ciIntelligence.resolveAllCommentsBeforeMainMerge,
              },
            }))}
          />
        </Row>
        <Row label={t("Resolve main merge conflicts")} description={t("Escalate `feature -> main` merge conflicts to the virtual worker with sprint context.")} badge={getFieldBadge("ciIntelligence.resolveMainMergeConflicts")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveMainMergeConflicts}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                resolveMainMergeConflicts: !current.ciIntelligence.resolveMainMergeConflicts,
              },
            }))}
          />
        </Row>
        <Row label={t("Fix main merge CI failures")} description={t("Dispatch the virtual worker to fix failing CI on the `feature -> main` merge gate before escalating to a human.")} badge={getFieldBadge("ciIntelligence.resolveMainMergeFailedChecks")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveMainMergeFailedChecks}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                resolveMainMergeFailedChecks: !current.ciIntelligence.resolveMainMergeFailedChecks,
              },
            }))}
          />
        </Row>
        <Row label={t("Resolve comments before feature merge")} description={t("Do not auto-merge a feature branch until review comments are closed.")} badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeFeatureMerge")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                resolveAllCommentsBeforeFeatureMerge: !current.ciIntelligence.resolveAllCommentsBeforeFeatureMerge,
              },
            }))}
          />
        </Row>
        <Row label={t("Resolve feature merge conflicts")} description={t("Escalate feature-branch merge conflicts to the virtual worker with full branch and task context.")} badge={getFieldBadge("ciIntelligence.resolveMergeConflicts")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveMergeConflicts}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                resolveMergeConflicts: !current.ciIntelligence.resolveMergeConflicts,
              },
            }))}
          />
        </Row>
        <Row label={t("Feature PR auto-merge mode")} description={t("Controls whether feature PRs stay at PR creation, auto-merge when green, auto-merge immediately when allowed, or stay off.")} badge={getFieldBadge("ciIntelligence.featurePrAutoMergeMode")}>
          <PillChoiceGroup
            value={editableSettings.git.githubMode === "LOCAL" ? "OFF" : editableSettings.ciIntelligence.featurePrAutoMergeMode}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                featurePrAutoMergeMode: value as ProjectSettings["ciIntelligence"]["featurePrAutoMergeMode"],
              },
            }))}
            options={[
              { value: "OFF", label: t("Off"), hint: t("Never auto-merge.") },
              { value: "CREATE_PR", label: t("Create PR"), hint: t("Open a PR without auto-merging it.") },
              { value: "WHEN_GREEN", label: t("When green"), hint: t("Merge only after checks pass.") },
              { value: "ALWAYS", label: t("Always"), hint: t("Merge as soon as policy allows.") },
            ]}
          />
        </Row>
        <Row label={t("Main branch auto-merge mode")} description={t("Controls whether the final main-branch PR stays off, is only created, auto-merges when green, or auto-merges immediately when allowed.")} badge={getFieldBadge("ciIntelligence.mainBranchAutoMergeMode")} last>
          <PillChoiceGroup
            value={editableSettings.git.githubMode === "LOCAL" ? "OFF" : editableSettings.ciIntelligence.mainBranchAutoMergeMode}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                mainBranchAutoMergeMode: value as ProjectSettings["ciIntelligence"]["mainBranchAutoMergeMode"],
              },
            }))}
            options={[
              { value: "OFF", label: t("Off"), hint: t("Never auto-merge.") },
              { value: "CREATE_PR", label: t("Create PR"), hint: t("Open the PR without auto-merging it.") },
              { value: "WHEN_GREEN", label: t("When green"), hint: t("Merge only after checks pass.") },
              { value: "ALWAYS", label: t("Always"), hint: t("Merge as soon as policy allows.") },
            ]}
          />
          </Row>
        </SectionCard>

      <QAPanel
        settings={qaSettings}
        update={(patch) => updateQaSettings((current) => ({ ...current, ...patch }))}
        getBadge={qaFieldBadge}
        sectionBadge={qaSectionBadge}
        presetOptions={qaPresetOptions}
        selectorsDisabled={qaPresetSelectorsDisabled}
        selectedProjectName={selectedProject?.name}
        activeScope={activeScope}
        selfReflection={qaSelfReflectionSettings}
        updateSelfReflection={(settings) => updateQaSelfReflectionSettings(() => settings)}
      />

      <SectionCard
        title={t("Guardrails")}
        watermark="CAP"
        badge={getBadge("guardrails")}
        icon={<ShieldAlert strokeWidth={2.4} />}
        highlights={[
          { label: t("Protection"), value: editableSettings.guardrails.enabled ? t("Enabled") : t("Off"), tone: editableSettings.guardrails.enabled ? "active" : "warning" },
          { label: t("Job types"), value: t("{count} capped", { count: guardrailJobMeta.length }) },
          { label: t("Task ceiling"), value: editableSettings.guardrails.perTaskTotalCeiling || t("Unlimited") },
        ]}
      >
          <Row label={t("Guardrails enabled")} description={t("Cap how many times each agent job type runs per task to stop runaway loops. Counts persist per task across restarts.")} badge={getFieldBadge("guardrails.enabled")}>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.guardrails.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                guardrails: { ...current.guardrails, enabled: !current.guardrails.enabled },
              }))}
            />
          </Row>

          {editableSettings.guardrails.enabled ? (
            <>
              {guardrailJobMeta.map((job) => (
                <Row
                  key={job.key}
                  label={job.label}
                  description={t("{description} 0 = unlimited.", { description: job.description })}
                  badge={getFieldBadge(`guardrails.jobs.${job.key}.cap`)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <NumberInput
                      value={editableSettings.guardrails.jobs[job.key].cap}
                      aria-label={job.label}
                      aria-description={t("{description} 0 = unlimited.", { description: job.description })}
                      min={0}
                      max={100}
                      errorText={getSettingsOperationsNumberError(editableSettings.guardrails.jobs[job.key].cap, 0, 100, t)}
                      onChange={(value) => updateEditableSettings((current) => ({
                        ...current,
                        guardrails: {
                          ...current.guardrails,
                          jobs: {
                            ...current.guardrails.jobs,
                            [job.key]: { ...current.guardrails.jobs[job.key], cap: value },
                          },
                        },
                      }))}
                    />
                    <PillChoiceGroup
                      value={editableSettings.guardrails.jobs[job.key].onLimit}
                      onChange={(value) => updateEditableSettings((current) => ({
                        ...current,
                        guardrails: {
                          ...current.guardrails,
                          jobs: {
                            ...current.guardrails.jobs,
                            [job.key]: { ...current.guardrails.jobs[job.key], onLimit: value as GuardrailOnLimitAction },
                          },
                        },
                      }))}
                      options={guardrailActionOptions}
                    />
                  </div>
                </Row>
              ))}

              <Row
                label={t("Per-task total ceiling")}
                description={t("Optional hard cap on total agent invocations per task across all job types. 0 disables.")}
                badge={getFieldBadge("guardrails.perTaskTotalCeiling")}
                last
              >
                <NumberInput
                  value={editableSettings.guardrails.perTaskTotalCeiling}
                  aria-label={t("Per-task total ceiling")}
                  aria-description={t("Optional hard cap on total agent invocations per task across all job types. 0 disables.")}
                  min={0}
                  max={500}
                  errorText={getSettingsOperationsNumberError(editableSettings.guardrails.perTaskTotalCeiling, 0, 500, t)}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    guardrails: { ...current.guardrails, perTaskTotalCeiling: value },
                  }))}
                />
              </Row>
            </>
          ) : null}
        </SectionCard>

        <SectionCard
          title={t("Rate Limit")}
          watermark="RATE"
          badge={getBadge("cliWorkflow")}
          icon={<Timer strokeWidth={2.4} />}
          highlights={[
            { label: t("Rate retries"), value: editableSettings.cliWorkflow.retryOnRateLimit ? t("Enabled") : t("Off"), tone: editableSettings.cliWorkflow.retryOnRateLimit ? "active" : "neutral" },
            { label: t("Delay"), value: `${editableSettings.cliWorkflow.rateLimitRetryDelaySeconds}s` },
            { label: t("Max retries"), value: editableSettings.cliWorkflow.maxRateLimitRetries },
          ]}
        >
          <Row label={t("Retry after quota reset")} description={t("When a provider reports a concrete quota reset time, wait for that reset and retry automatically.")} badge={getFieldBadge("cliWorkflow.retryOnQuotaReset")}>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.cliWorkflow.retryOnQuotaReset} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnQuotaReset: !current.cliWorkflow.retryOnQuotaReset,
              },
            }))} />
          </Row>
          <Row label={t("Retry on rate limit")} description={t("Retry transient rate-limit failures after a fixed delay until the configured max retry count is reached.")} badge={getFieldBadge("cliWorkflow.retryOnRateLimit")}>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.cliWorkflow.retryOnRateLimit} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnRateLimit: !current.cliWorkflow.retryOnRateLimit,
              },
            }))} />
          </Row>
          <Row label={t("Rate limit retry delay")} description={t("Seconds to wait before retrying a rate-limited provider call.")} badge={getFieldBadge("cliWorkflow.rateLimitRetryDelaySeconds")}>
            <NumberInput
              value={editableSettings.cliWorkflow.rateLimitRetryDelaySeconds}
              aria-label={t("Rate limit retry delay")}
              aria-description={t("Seconds to wait before retrying a rate-limited provider call.")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  rateLimitRetryDelaySeconds: value,
                },
              }))}
              min={1}
              max={3600}
              errorText={getSettingsOperationsNumberError(editableSettings.cliWorkflow.rateLimitRetryDelaySeconds, 1, 3600, t)}
            />
          </Row>
          <Row label={t("Max rate limit retries")} description={t("Maximum retry attempts for rate-limited provider calls before Code UX fails the invocation.")} badge={getFieldBadge("cliWorkflow.maxRateLimitRetries")}>
            <NumberInput
              value={editableSettings.cliWorkflow.maxRateLimitRetries}
              aria-label={t("Max rate limit retries")}
              aria-description={t("Maximum retry attempts for rate-limited provider calls before Code UX fails the invocation.")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  maxRateLimitRetries: value,
                },
              }))}
              min={1}
              max={100}
              errorText={getSettingsOperationsNumberError(editableSettings.cliWorkflow.maxRateLimitRetries, 1, 100, t)}
            />
          </Row>
          <Row label={t("Max quota retries without timer")} description={t("When a provider reports quota exhaustion without an exact reset time, retry up to this many times before failing the task.")} badge={getFieldBadge("cliWorkflow.maxQuotaRetriesWithoutTimer")} last>
            <NumberInput
              value={editableSettings.cliWorkflow.maxQuotaRetriesWithoutTimer}
              aria-label={t("Max quota retries without timer")}
              aria-description={t("When a provider reports quota exhaustion without an exact reset time, retry up to this many times before failing the task.")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  maxQuotaRetriesWithoutTimer: value,
                },
              }))}
              min={1}
              max={20}
              errorText={getSettingsOperationsNumberError(editableSettings.cliWorkflow.maxQuotaRetriesWithoutTimer, 1, 20, t)}
            />
          </Row>
        </SectionCard>

        <SectionCard
          title={t("Watch Loop")}
          watermark="LOOP"
          badge={getBadge("sprintLoopSteps")}
          icon={<Eye strokeWidth={2.4} />}
          highlights={[
            { label: t("Loop"), value: editableSettings.sprintLoopSteps.watchLoop ? t("Running") : t("Off"), tone: editableSettings.sprintLoopSteps.watchLoop ? "active" : "warning" },
            { label: t("Evaluation"), value: `${editableSettings.sprintLoopSteps.watchLoopIntervalSeconds}s` },
            { label: t("Output"), value: `${editableSettings.sprintLoopSteps.watchLoopOutputIntervalSeconds}s` },
          ]}
        >
          <Row label={t("Watch loop")} description={t("Keep the live watch loop running between orchestration ticks.")} badge={getFieldBadge("sprintLoopSteps.watchLoop")}>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintLoopSteps.watchLoop} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                watchLoop: !current.sprintLoopSteps.watchLoop,
              },
            }))} />
          </Row>
          <Row label={t("Watch loop interval")} description={t("Seconds between watch loop evaluation cycles.")} badge={getFieldBadge("sprintLoopSteps.watchLoopIntervalSeconds")}>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopIntervalSeconds}
              aria-label={t("Watch loop interval")}
              aria-description={t("Seconds between watch loop evaluation cycles.")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
              errorText={getSettingsOperationsNumberError(editableSettings.sprintLoopSteps.watchLoopIntervalSeconds, 1, 3600, t)}
            />
          </Row>
          <Row label={t("Watch output interval")} description={t("Seconds between watch loop output emissions.")} badge={getFieldBadge("sprintLoopSteps.watchLoopOutputIntervalSeconds")} last>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopOutputIntervalSeconds}
              aria-label={t("Watch output interval")}
              aria-description={t("Seconds between watch loop output emissions.")}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopOutputIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
              errorText={getSettingsOperationsNumberError(editableSettings.sprintLoopSteps.watchLoopOutputIntervalSeconds, 1, 3600, t)}
            />
          </Row>
        </SectionCard>

        <SectionCard
          title={t("Workspace Hygiene")}
          watermark="CLI"
          badge={getBadge("cliWorkflow")}
          icon={<Sparkles strokeWidth={2.4} />}
          highlights={[
            { label: t("On success"), value: editableSettings.cliWorkflow.cleanupWorktreeOnSuccess ? t("Clean") : t("Keep") },
            { label: t("On failure"), value: editableSettings.cliWorkflow.cleanupWorktreeOnFailure ? t("Clean") : t("Keep") },
            { label: t("Policy"), value: editableSettings.cliWorkflow.cleanupWorktreeOnSuccess && editableSettings.cliWorkflow.cleanupWorktreeOnFailure ? t("Automatic") : t("Selective"), tone: "active" },
          ]}
        >
          <Row label={t("Cleanup worktree on success")} description={t("Remove temporary worktree state after successful CLI execution.")} badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnSuccess")}>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.cliWorkflow.cleanupWorktreeOnSuccess} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnSuccess: !current.cliWorkflow.cleanupWorktreeOnSuccess,
              },
            }))} />
          </Row>
          <Row label={t("Cleanup worktree on failure")} description={t("Clean up failed workspaces after execution terminates unsuccessfully.")} badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnFailure")} last>
            <Toggle aria-label={t("Toggle setting")} value={editableSettings.cliWorkflow.cleanupWorktreeOnFailure} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnFailure: !current.cliWorkflow.cleanupWorktreeOnFailure,
              },
            }))} />
          </Row>
        </SectionCard>

        {editingPrTemplate ? (
          <PrTemplateEditorModal
            isOpen
            kind={editingPrTemplate}
            state={state}
            onClose={() => setEditingPrTemplate(null)}
          />
        ) : null}
    </div>
  );
};
