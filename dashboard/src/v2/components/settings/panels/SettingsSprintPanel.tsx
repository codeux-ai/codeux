import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, TextInput, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings, ProviderId, InvocationRoutingId } from "../../../../types.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { ExternalLink } from "lucide-preact";

  export const SettingsSprintPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
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
        <SectionCard title="Merge Gates" watermark="CI" badge={getBadge("ciIntelligence")}>
          <Row label="CI intelligence enabled" description="Let orchestration react to CI state instead of treating CI as passive metadata." badge={getFieldBadge("ciIntelligence.enabled")}>
            <Toggle
              value={editableSettings.ciIntelligence.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  enabled: !current.ciIntelligence.enabled,
                },
              }))}
            />
          </Row>
          <Row label="Live PR monitoring" description="Poll and interpret PR state while feature work is in progress." badge={getFieldBadge("ciIntelligence.enableLivePrMonitoring")}>
            <Toggle
              value={editableSettings.ciIntelligence.enableLivePrMonitoring}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  enableLivePrMonitoring: !current.ciIntelligence.enableLivePrMonitoring,
                },
              }))}
            />
          </Row>
          <Row label="Wait for CI before main merge" description="Hold main-branch merge completion until CI is green." badge={getFieldBadge("ciIntelligence.waitForCiBeforeMainMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.waitForCiBeforeMainMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForCiBeforeMainMerge: !current.ciIntelligence.waitForCiBeforeMainMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve comments before main merge" description="Require review comments to be resolved before finishing the main merge." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeMainMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveAllCommentsBeforeMainMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveAllCommentsBeforeMainMerge: !current.ciIntelligence.resolveAllCommentsBeforeMainMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve main merge conflicts" description="Escalate `feature -> main` merge conflicts to the connected worker with sprint context." badge={getFieldBadge("ciIntelligence.resolveMainMergeConflicts")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveMainMergeConflicts}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveMainMergeConflicts: !current.ciIntelligence.resolveMainMergeConflicts,
                },
              }))}
            />
          </Row>
          <Row label="Wait for CI before feature merge" description="Require green CI before merging feature branches back into sprint or main flow." badge={getFieldBadge("ciIntelligence.waitForCiBeforeFeatureMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.waitForCiBeforeFeatureMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForCiBeforeFeatureMerge: !current.ciIntelligence.waitForCiBeforeFeatureMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve comments before feature merge" description="Do not auto-merge a feature branch until review comments are closed." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeFeatureMerge")} last>
            <Toggle
              value={editableSettings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveAllCommentsBeforeFeatureMerge: !current.ciIntelligence.resolveAllCommentsBeforeFeatureMerge,
                },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Autofix Policy" watermark="FIX" badge={getBadge("ciIntelligence")}>
          <Row label="Resolve feature merge conflicts" description="Escalate feature-branch merge conflicts to the connected worker with full branch and task context." badge={getFieldBadge("ciIntelligence.resolveMergeConflicts")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveMergeConflicts}
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
              value={editableSettings.ciIntelligence.waitForJulesCiAutofix}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForJulesCiAutofix: !current.ciIntelligence.waitForJulesCiAutofix,
                },
              }))}
            />
          </Row>
          <Row label="Autofix retries" description="Maximum retries for the Jules CI autofix path." badge={getFieldBadge("ciIntelligence.julesCiAutofixMaxRetries")}>
            <NumberInput
              value={editableSettings.ciIntelligence.julesCiAutofixMaxRetries}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  julesCiAutofixMaxRetries: value,
                },
              }))}
              min={0}
              max={20}
            />
          </Row>
          <Row label="Feature PR auto-merge mode" description="Controls whether feature PRs stay at PR creation, auto-merge when green, auto-merge immediately when allowed, or stay off." badge={getFieldBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <PillChoiceGroup
              value={editableSettings.ciIntelligence.featurePrAutoMergeMode}
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
              value={editableSettings.ciIntelligence.mainBranchAutoMergeMode}
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

        <SectionCard title="Execution Pipeline" watermark="RUN" badge={getBadge("sprintLoopSteps")}>
          <Row label="Branch preflight" description="Verify branch state before the orchestration loop starts." badge={getFieldBadge("sprintLoopSteps.branchPreflight")}>
            <Toggle value={editableSettings.sprintLoopSteps.branchPreflight} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                branchPreflight: !current.sprintLoopSteps.branchPreflight,
              },
            }))} />
          </Row>
          <Row label="Planning preflight" description="Validate the planning phase before worker or automated execution begins." badge={getFieldBadge("sprintLoopSteps.planningPreflight")}>
            <Toggle value={editableSettings.sprintLoopSteps.planningPreflight} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                planningPreflight: !current.sprintLoopSteps.planningPreflight,
              },
            }))} />
          </Row>
          <Row label="Session sync" description="Keep provider session state synchronized into the orchestration model." badge={getFieldBadge("sprintLoopSteps.sessionSync")}>
            <Toggle value={editableSettings.sprintLoopSteps.sessionSync} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                sessionSync: !current.sprintLoopSteps.sessionSync,
              },
            }))} />
          </Row>
          <Row label="Load subtasks" description="Refresh task state from persisted sprint records before orchestration decisions are made." badge={getFieldBadge("sprintLoopSteps.loadSubtasks")}>
            <Toggle value={editableSettings.sprintLoopSteps.loadSubtasks} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                loadSubtasks: !current.sprintLoopSteps.loadSubtasks,
              },
            }))} />
          </Row>
          <Row label="Status derivation" description="Derive task runtime status from session, merge, and CI state during each loop." badge={getFieldBadge("sprintLoopSteps.statusDerivation")}>
            <Toggle value={editableSettings.sprintLoopSteps.statusDerivation} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                statusDerivation: !current.sprintLoopSteps.statusDerivation,
              },
            }))} />
          </Row>
          <Row label="Start ready tasks" description="Dispatch work automatically once dependency and merge gates are clear." badge={getFieldBadge("sprintLoopSteps.startReadyTasks")}>
            <Toggle value={editableSettings.sprintLoopSteps.startReadyTasks} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                startReadyTasks: !current.sprintLoopSteps.startReadyTasks,
              },
            }))} />
          </Row>
          <Row label="Merge protocol" description="Run merge-state checks and PR integration logic as part of each loop." badge={getFieldBadge("sprintLoopSteps.mergeProtocol")}>
            <Toggle value={editableSettings.sprintLoopSteps.mergeProtocol} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                mergeProtocol: !current.sprintLoopSteps.mergeProtocol,
              },
            }))} />
          </Row>
          <Row label="Action-required protocol" description="Pause and surface manual intervention when automated resolution is not possible." badge={getFieldBadge("sprintLoopSteps.actionRequiredProtocol")}>
            <Toggle value={editableSettings.sprintLoopSteps.actionRequiredProtocol} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                actionRequiredProtocol: !current.sprintLoopSteps.actionRequiredProtocol,
              },
            }))} />
          </Row>
          <Row label="Status table output" description="Emit the orchestration status table as part of the loop output." badge={getFieldBadge("sprintLoopSteps.statusTable")} last>
            <Toggle value={editableSettings.sprintLoopSteps.statusTable} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                statusTable: !current.sprintLoopSteps.statusTable,
              },
            }))} />
          </Row>
        </SectionCard>

        <SectionCard title="Watch Loop" watermark="LOOP" badge={getBadge("sprintLoopSteps")}>
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

        <SectionCard title="Workspace Hygiene" watermark="CLI" badge={getBadge("cliWorkflow")}>
          <Row label="Cleanup worktree on success" description="Remove temporary worktree state after successful CLI execution." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnSuccess")}>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnSuccess} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnSuccess: !current.cliWorkflow.cleanupWorktreeOnSuccess,
              },
            }))} />
          </Row>
          <Row label="Cleanup worktree on failure" description="Clean up failed workspaces after execution terminates unsuccessfully." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnFailure")}>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnFailure} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnFailure: !current.cliWorkflow.cleanupWorktreeOnFailure,
              },
            }))} />
          </Row>
          <Row label="Retry on read-file errors" description="Retry when a CLI agent fails on a transient file read issue." badge={getFieldBadge("cliWorkflow.retryOnReadFileNotFound")}>
            <Toggle value={editableSettings.cliWorkflow.retryOnReadFileNotFound} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnReadFileNotFound: !current.cliWorkflow.retryOnReadFileNotFound,
              },
            }))} />
          </Row>
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
          <Row label="Max rate limit retries" description="Maximum retry attempts for rate-limited provider calls before Sprint OS fails the invocation." badge={getFieldBadge("cliWorkflow.maxRateLimitRetries")}>
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
          <Row label="Resume failed task in same workspace" description="Reuse the same workspace for a retry instead of provisioning a fresh one." badge={getFieldBadge("cliWorkflow.resumeFailedTaskInSameWorkspace")}>
            <Toggle value={editableSettings.cliWorkflow.resumeFailedTaskInSameWorkspace} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                resumeFailedTaskInSameWorkspace: !current.cliWorkflow.resumeFailedTaskInSameWorkspace,
              },
            }))} />
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

        <SectionCard title="Execution Runtime" watermark="RT" badge={getBadge("cliWorkflow")}>
          <Row label="Execution mode" description="Run worker CLI processes directly on the host or inside a container." badge={getFieldBadge("cliWorkflow.executionMode")}>
            <PillChoiceGroup
              value={editableSettings.cliWorkflow.executionMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  executionMode: value as ProjectSettings["cliWorkflow"]["executionMode"],
                },
              }))}
              options={[
                { value: "HOST", label: "Host", hint: "Use the local runtime directly." },
                { value: "DOCKER", label: "Docker", hint: "Run in a contained build environment." },
              ]}
            />
          </Row>
          <Row label="Container image" description="Default container image when execution mode is Docker." badge={getFieldBadge("cliWorkflow.containerImage")}>
            <TextInput
              value={editableSettings.cliWorkflow.containerImage}
              onChange={(value) => updateEditableSettings((current) => ({
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
              value={editableSettings.cliWorkflow.containerSetupScriptPath}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                containerSetupScriptPath: value,
              },
            }))}
              mono
            />
          </Row>
          <Row label="Cache setup as image" description="Build and reuse a derived Docker image from the base image plus setup script contents." badge={getFieldBadge("cliWorkflow.containerCacheSetupScriptImage")}>
            <Toggle value={editableSettings.cliWorkflow.containerCacheSetupScriptImage} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                containerCacheSetupScriptImage: !current.cliWorkflow.containerCacheSetupScriptImage,
              },
            }))} />
          </Row>
          <Row label="Mount git config" description="Share host git config with the task container." badge={getFieldBadge("cliWorkflow.containerMountGitConfig")} last>
            <Toggle value={editableSettings.cliWorkflow.containerMountGitConfig} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                containerMountGitConfig: !current.cliWorkflow.containerMountGitConfig,
              },
            }))} />
          </Row>
        </SectionCard>

        <SectionCard title="Sprint Browser" watermark="WEB" badge={getBadge("sprintPreview")}>
          <Row label="Auto-start running sprint previews" description="Launch the preview container automatically when a sprint enters the running state." badge={getFieldBadge("sprintPreview.autoStartOnRunningSprint")}>
            <Toggle value={editableSettings.sprintPreview.autoStartOnRunningSprint} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                autoStartOnRunningSprint: !current.sprintPreview.autoStartOnRunningSprint,
              },
            }))} />
          </Row>
          <Row label="Rebuild after task completion" description="Rebuild the active sprint preview whenever the completed task count increases." badge={getFieldBadge("sprintPreview.rebuildOnTaskCompletion")}>
            <Toggle value={editableSettings.sprintPreview.rebuildOnTaskCompletion} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                rebuildOnTaskCompletion: !current.sprintPreview.rebuildOnTaskCompletion,
              },
            }))} />
          </Row>
          <Row label="Rebuild after sprint completion" description="Run one last preview rebuild when the sprint reaches a terminal completed state." badge={getFieldBadge("sprintPreview.rebuildOnSprintCompletion")}>
            <Toggle value={editableSettings.sprintPreview.rebuildOnSprintCompletion} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                rebuildOnSprintCompletion: !current.sprintPreview.rebuildOnSprintCompletion,
              },
            }))} />
          </Row>
          <Row label="Auto-stop on terminal sprint" description="Stop preview containers automatically when their sprint finishes or is otherwise terminal." badge={getFieldBadge("sprintPreview.autoStopOnTerminalSprint")}>
            <Toggle value={editableSettings.sprintPreview.autoStopOnTerminalSprint} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                autoStopOnTerminalSprint: !current.sprintPreview.autoStopOnTerminalSprint,
              },
            }))} />
          </Row>
          <Row label="Host port range start" description="Lower bound for the preview port allocator. Preview ports bind to localhost only." badge={getFieldBadge("sprintPreview.hostPortRangeStart")}>
            <NumberInput
              value={editableSettings.sprintPreview.hostPortRangeStart}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintPreview: {
                  ...current.sprintPreview,
                  hostPortRangeStart: value,
                },
              }))}
              min={1}
              max={65535}
            />
          </Row>
          <Row label="Host port range end" description="Upper bound for the preview port allocator. Keep the range large enough for concurrent sprint previews." badge={getFieldBadge("sprintPreview.hostPortRangeEnd")}>
            <NumberInput
              value={editableSettings.sprintPreview.hostPortRangeEnd}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintPreview: {
                  ...current.sprintPreview,
                  hostPortRangeEnd: value,
                },
              }))}
              min={1}
              max={65535}
            />
          </Row>
          <Row label="Container app port" description="Internal port the preview process listens on inside the container before it is mapped to a random host port." badge={getFieldBadge("sprintPreview.containerAppPort")}>
            <NumberInput
              value={editableSettings.sprintPreview.containerAppPort}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintPreview: {
                  ...current.sprintPreview,
                  containerAppPort: value,
                },
              }))}
              min={1}
              max={65535}
            />
          </Row>
          <Row label="Startup script path" description="Project-relative path used for the editable sprint preview startup script override." badge={getFieldBadge("sprintPreview.startupScriptPath")} last>
            <TextInput
              value={editableSettings.sprintPreview.startupScriptPath}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintPreview: {
                  ...current.sprintPreview,
                  startupScriptPath: value,
                },
              }))}
              mono
            />
          </Row>
        </SectionCard>
      </div>
    );
  };
