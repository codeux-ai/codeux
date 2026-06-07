import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings, GuardrailJobType, GuardrailOnLimitAction } from "../../../../types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Eye, GitBranch, GitMerge, PlayCircle, ShieldAlert, Sparkles, Timer } from "lucide-preact";

const GUARDRAIL_JOB_META: Array<{ key: GuardrailJobType; label: string; description: string }> = [
  { key: "task_coding", label: "Coding attempts", description: "Max times a task is (re)dispatched for coding before it is blocked." },
  { key: "ci_fix", label: "CI autofix attempts", description: "Max CI autofix attempts (Jules notify or worker) per task." },
  { key: "merge_conflict", label: "Merge conflict resolutions", description: "Max merge-conflict resolution attempts per task." },
  { key: "clarification_reply", label: "Clarification auto-answers", description: "Max automatic clarification replies before waiting for a human." },
  { key: "planning", label: "Planning runs", description: "Max planning invocations attributed to a single task." },
];

const GUARDRAIL_ACTION_OPTIONS: Array<{ value: GuardrailOnLimitAction; label: string; hint: string }> = [
  { value: "BLOCK_AND_ESCALATE", label: "Block + escalate", hint: "Block the task and hand it to a human." },
  { value: "STOP_AND_WAIT", label: "Stop + wait", hint: "Stop auto-handling and wait for a human." },
  { value: "WARN_ONLY", label: "Warn only", hint: "Log a warning but keep going." },
];
import { SprintKeyEditor } from "../SprintKeyEditor.js";
import { InfoIconPopover } from "../../ui/InfoIconPopover.js";
import { BranchNameSchemeEditor } from "../BranchNameSchemeEditor.js";


export const SettingsSprintPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    editableSettings,
    projectSources,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  if (!editableSettings) {
    return null;
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Git Flow" watermark="GIT" badge={getBadge("git")} icon={<GitBranch strokeWidth={2.4} />}>
        <Row label="Git mode" description="Remote enables PR and CI-aware automation. Local keeps orchestration repo-local only." badge={getFieldBadge("git.githubMode")}>
          <PillChoiceGroup
            value={editableSettings.git.githubMode}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              git: {
                ...current.git,
                githubMode: value as ProjectSettings["git"]["githubMode"],
              },
            }))}
            options={[
              { value: "REMOTE", label: "Remote", hint: "PRs, CI, and remote branch sync stay enabled." },
              { value: "LOCAL", label: "Local", hint: "Disable remote PR orchestration and stay repo-local." },
            ]}
          />
        </Row>
        <Row label="Default branch" description="Base branch used for sprint branch creation and merge targets." badge={getFieldBadge("git.defaultBranch")}>
          <TextInput
            value={editableSettings.git.defaultBranch}
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
        <Row label="Feature branch prefix" description="Prefix used when worker feature branches are generated automatically." badge={getFieldBadge("git.featureBranchPrefix")}>
          <TextInput
            value={editableSettings.git.featureBranchPrefix}
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
          label="Branch name scheme"
          description="Template used when naming sprint branches."
          badge={getFieldBadge("git.sprintBranchScheme")}
          info={<InfoIconPopover items={[
            { key: "{sprint_key_prefix}", desc: "Sprint Key Prefix" },
            { key: "{sprint_number}", desc: "Sprint Number" },
            { key: "{sprint_name}", desc: "Sprint Name" },
            { key: "{sprint_id}", desc: "Sprint ID" },
            { key: "{planning_agent}", desc: "Planning Agent" },
            { key: "{agent_routing}", desc: "Agent Routing" },
            { key: "{worker_agent}", desc: "Worker Agent" },
            { key: "{worker_provider}", desc: "Worker Provider" },
            { key: "{worker_model}", desc: "Worker Model" },
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

        <Row label="Auto-create PRs" description={editableSettings.git.githubMode === "LOCAL" ? "Open pull requests automatically for remote git workflows. (Disabled in Local mode)" : "Open pull requests automatically for remote git workflows."} badge={getFieldBadge("git.autoCreatePr")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.git.autoCreatePr}
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
        <Row label="Auto-close linked issues" description={editableSettings.git.githubMode === "LOCAL" ? "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete. (Disabled in Local mode)" : "Close imported GitHub/GitLab issues after the sprint finishes and the main merge gate is complete."} badge={getFieldBadge("git.autoCloseLinkedIssues")} last>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.git.autoCloseLinkedIssues}
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
      </SectionCard>

      <SectionCard
        title={editableSettings.git.githubMode === "LOCAL" ? "Merge Gates & Autofix (Unavailable in Local Mode)" : "Merge Gates & Autofix"}
        watermark="CI"
        badge={editableSettings.git.githubMode === "LOCAL" ? "Disabled in Local Mode" : getBadge("ciIntelligence")}
        icon={<GitMerge strokeWidth={2.4} />}
      >
        <Row label="Resolve comments before main merge" description="Require review comments to be resolved before finishing the main merge." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeMainMerge")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveAllCommentsBeforeMainMerge}
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
        <Row label="Resolve main merge conflicts" description="Escalate `feature -> main` merge conflicts to the virtual worker with sprint context." badge={getFieldBadge("ciIntelligence.resolveMainMergeConflicts")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveMainMergeConflicts}
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
        <Row label="Resolve comments before feature merge" description="Do not auto-merge a feature branch until review comments are closed." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeFeatureMerge")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge}
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
        <Row label="Resolve feature merge conflicts" description="Escalate feature-branch merge conflicts to the virtual worker with full branch and task context." badge={getFieldBadge("ciIntelligence.resolveMergeConflicts")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.resolveMergeConflicts}
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
        <Row label="Jules CI autofix" description="Allow Jules to attempt CI autofixes before escalating to a worker." badge={getFieldBadge("ciIntelligence.waitForJulesCiAutofix")}>
          <Toggle
            value={editableSettings.git.githubMode === "LOCAL" ? false : editableSettings.ciIntelligence.waitForJulesCiAutofix}
            disabled={editableSettings.git.githubMode === "LOCAL"}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                waitForJulesCiAutofix: !current.ciIntelligence.waitForJulesCiAutofix,
              },
            }))}
          />
        </Row>
        <Row label="Feature PR auto-merge mode" description="Controls whether feature PRs stay at PR creation, auto-merge when green, auto-merge immediately when allowed, or stay off." badge={getFieldBadge("ciIntelligence.featurePrAutoMergeMode")}>
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
              { value: "OFF", label: "Off", hint: "Never auto-merge." },
              { value: "CREATE_PR", label: "Create PR", hint: "Open a PR without auto-merging it." },
              { value: "WHEN_GREEN", label: "When green", hint: "Merge only after checks pass." },
              { value: "ALWAYS", label: "Always", hint: "Merge as soon as policy allows." },
            ]}
          />
        </Row>
        <Row label="Main branch auto-merge mode" description="Controls whether the final main-branch PR stays off, is only created, auto-merges when green, or auto-merges immediately when allowed." badge={getFieldBadge("ciIntelligence.mainBranchAutoMergeMode")} last>
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
              { value: "OFF", label: "Off", hint: "Never auto-merge." },
              { value: "CREATE_PR", label: "Create PR", hint: "Open the PR without auto-merging it." },
              { value: "WHEN_GREEN", label: "When green", hint: "Merge only after checks pass." },
              { value: "ALWAYS", label: "Always", hint: "Merge as soon as policy allows." },
            ]}
          />
        </Row>
      </SectionCard>

        <SectionCard title="Guardrails" watermark="CAP" badge={getBadge("guardrails")} icon={<ShieldAlert strokeWidth={2.4} />}>
          <Row label="Guardrails enabled" description="Cap how many times each agent job type runs per task to stop runaway loops. Counts persist per task across restarts." badge={getFieldBadge("guardrails.enabled")}>
            <Toggle
              value={editableSettings.guardrails.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                guardrails: { ...current.guardrails, enabled: !current.guardrails.enabled },
              }))}
            />
          </Row>

          {editableSettings.guardrails.enabled ? (
            <>
              {GUARDRAIL_JOB_META.map((job) => (
                <Row
                  key={job.key}
                  label={job.label}
                  description={`${job.description} 0 = unlimited.`}
                  badge={getFieldBadge(`guardrails.jobs.${job.key}.cap`)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <NumberInput
                      value={editableSettings.guardrails.jobs[job.key].cap}
                      min={0}
                      max={100}
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
                      options={GUARDRAIL_ACTION_OPTIONS}
                    />
                  </div>
                </Row>
              ))}

              <Row
                label="Per-task total ceiling"
                description="Optional hard cap on total agent invocations per task across all job types. 0 disables."
                badge={getFieldBadge("guardrails.perTaskTotalCeiling")}
              >
                <NumberInput
                  value={editableSettings.guardrails.perTaskTotalCeiling}
                  min={0}
                  max={500}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    guardrails: { ...current.guardrails, perTaskTotalCeiling: value },
                  }))}
                />
              </Row>

              <Row
                label="Max QA runs (guardrail)"
                description="Hard per-task cap on QA review runs. Separate from the QA agent's own max runs. 0 = unlimited."
                badge={getFieldBadge("guardrails.qaRunsCap")}
                last
              >
                <NumberInput
                  value={editableSettings.guardrails.qaRunsCap}
                  min={0}
                  max={100}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    guardrails: { ...current.guardrails, qaRunsCap: value },
                  }))}
                />
              </Row>

              {editableSettings.guardrails.qaRunsCap > 0
                && editableSettings.guardrails.qaRunsCap < editableSettings.agents.qualityAssurance.maxTaskReviewRuns ? (
                <div className="rounded-[1.15rem] border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-xs leading-relaxed text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/[0.08] dark:text-amber-200">
                  The QA guardrail cap ({editableSettings.guardrails.qaRunsCap}) is lower than the QA agent&apos;s configured max runs
                  ({editableSettings.agents.qualityAssurance.maxTaskReviewRuns}). The guardrail will cut QA short before it completes its configured review passes.
                </div>
              ) : null}
            </>
          ) : null}
        </SectionCard>

        <SectionCard title="Rate Limit" watermark="RATE" badge={getBadge("cliWorkflow")} icon={<Timer strokeWidth={2.4} />}>
          <Row label="Retry after quota reset" description="When a provider reports a concrete quota reset time, wait for that reset and retry automatically." badge={getFieldBadge("cliWorkflow.retryOnQuotaReset")}>
            <Toggle value={editableSettings.cliWorkflow.retryOnQuotaReset} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnQuotaReset: !current.cliWorkflow.retryOnQuotaReset,
              },
            }))} />
          </Row>
          <Row label="Retry on rate limit" description="Retry transient rate-limit failures after a fixed delay until the configured max retry count is reached." badge={getFieldBadge("cliWorkflow.retryOnRateLimit")}>
            <Toggle value={editableSettings.cliWorkflow.retryOnRateLimit} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnRateLimit: !current.cliWorkflow.retryOnRateLimit,
              },
            }))} />
          </Row>
          <Row label="Rate limit retry delay" description="Seconds to wait before retrying a rate-limited provider call." badge={getFieldBadge("cliWorkflow.rateLimitRetryDelaySeconds")}>
            <NumberInput
              value={editableSettings.cliWorkflow.rateLimitRetryDelaySeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  rateLimitRetryDelaySeconds: value,
                },
              }))}
              min={1}
              max={3600}
            />
          </Row>
          <Row label="Max rate limit retries" description="Maximum retry attempts for rate-limited provider calls before Code UX fails the invocation." badge={getFieldBadge("cliWorkflow.maxRateLimitRetries")}>
            <NumberInput
              value={editableSettings.cliWorkflow.maxRateLimitRetries}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  maxRateLimitRetries: value,
                },
              }))}
              min={1}
              max={100}
            />
          </Row>
          <Row label="Max quota retries without timer" description="When a provider reports quota exhaustion without an exact reset time, retry up to this many times before failing the task." badge={getFieldBadge("cliWorkflow.maxQuotaRetriesWithoutTimer")} last>
            <NumberInput
              value={editableSettings.cliWorkflow.maxQuotaRetriesWithoutTimer}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  maxQuotaRetriesWithoutTimer: value,
                },
              }))}
              min={1}
              max={20}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Watch Loop" watermark="LOOP" badge={getBadge("sprintLoopSteps")} icon={<Eye strokeWidth={2.4} />}>
          <Row label="Watch loop" description="Keep the live watch loop running between orchestration ticks." badge={getFieldBadge("sprintLoopSteps.watchLoop")}>
            <Toggle value={editableSettings.sprintLoopSteps.watchLoop} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                watchLoop: !current.sprintLoopSteps.watchLoop,
              },
            }))} />
          </Row>
          <Row label="Watch loop interval" description="Seconds between watch loop evaluation cycles." badge={getFieldBadge("sprintLoopSteps.watchLoopIntervalSeconds")}>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopIntervalSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
            />
          </Row>
          <Row label="Watch output interval" description="Seconds between watch loop output emissions." badge={getFieldBadge("sprintLoopSteps.watchLoopOutputIntervalSeconds")} last>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopOutputIntervalSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopOutputIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Workspace Hygiene" watermark="CLI" badge={getBadge("cliWorkflow")} icon={<Sparkles strokeWidth={2.4} />}>
          <Row label="Cleanup worktree on success" description="Remove temporary worktree state after successful CLI execution." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnSuccess")}>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnSuccess} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnSuccess: !current.cliWorkflow.cleanupWorktreeOnSuccess,
              },
            }))} />
          </Row>
          <Row label="Cleanup worktree on failure" description="Clean up failed workspaces after execution terminates unsuccessfully." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnFailure")} last>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnFailure} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnFailure: !current.cliWorkflow.cleanupWorktreeOnFailure,
              },
            }))} />
          </Row>
        </SectionCard>
    </div>
  );
};
