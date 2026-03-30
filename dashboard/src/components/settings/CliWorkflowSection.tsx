import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { updateCliWorkflow } from "../../lib/settings-updaters.js";
import { SettingsCard, ToggleRow } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";
import { DockerCredentialsSection } from "../ui/settings/DockerCredentialsSection.js";
import { ExecutionModeSelector } from "../ui/settings/ExecutionModeSelector.js";

export const CliWorkflowSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => {
  const applyCliWorkflowUpdate = (next: Partial<DashboardSettings["cliWorkflow"]>): void => {
    onChange(updateCliWorkflow(settings, next));
  };

  return (
    <SettingsCard
      title="CLI Workflow"
      description="Controls background Gemini/Codex/Claude Code worktree lifecycle and retry behavior."
    >
      <ExecutionModeSelector
        executionMode={settings.cliWorkflow.executionMode}
        onChange={(executionMode) => applyCliWorkflowUpdate({ executionMode })}
      />

      <ToggleRow
        label="Cleanup worktree on success"
        checked={settings.cliWorkflow.cleanupWorktreeOnSuccess}
        onToggle={(cleanupWorktreeOnSuccess) =>
          applyCliWorkflowUpdate({ cleanupWorktreeOnSuccess })
        }
      />
      <ToggleRow
        label="Cleanup worktree on failure"
        checked={settings.cliWorkflow.cleanupWorktreeOnFailure}
        onToggle={(cleanupWorktreeOnFailure) =>
          applyCliWorkflowUpdate({ cleanupWorktreeOnFailure })
        }
      />
      <ToggleRow
        label="Retry once on `read_file` not found"
        checked={settings.cliWorkflow.retryOnReadFileNotFound}
        onToggle={(retryOnReadFileNotFound) =>
          applyCliWorkflowUpdate({ retryOnReadFileNotFound })
        }
      />
      <ToggleRow
        label="Retry after quota reset"
        checked={settings.cliWorkflow.retryOnQuotaReset}
        onToggle={(retryOnQuotaReset) =>
          applyCliWorkflowUpdate({ retryOnQuotaReset })
        }
      />
      <ToggleRow
        label="Retry on rate limit"
        checked={settings.cliWorkflow.retryOnRateLimit}
        onToggle={(retryOnRateLimit) =>
          applyCliWorkflowUpdate({ retryOnRateLimit })
        }
      />
      <ToggleRow
        label="Resume failed task in same workspace"
        checked={settings.cliWorkflow.resumeFailedTaskInSameWorkspace}
        onToggle={(resumeFailedTaskInSameWorkspace) =>
          applyCliWorkflowUpdate({ resumeFailedTaskInSameWorkspace })
        }
      />

      <div className="flex items-center justify-between py-2">
        <label className="text-sm text-white/80">Max quota retries without timer</label>
        <input
          type="number"
          min={1}
          max={20}
          value={settings.cliWorkflow.maxQuotaRetriesWithoutTimer}
          onChange={(e) =>
            applyCliWorkflowUpdate({
              maxQuotaRetriesWithoutTimer: Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 5)),
            })
          }
          className="w-20 rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10"
        />
      </div>

      <div className="flex items-center justify-between py-2">
        <label className="text-sm text-white/80">Rate limit retry delay (seconds)</label>
        <input
          type="number"
          min={1}
          max={3600}
          value={settings.cliWorkflow.rateLimitRetryDelaySeconds}
          onChange={(e) =>
            applyCliWorkflowUpdate({
              rateLimitRetryDelaySeconds: Math.max(1, Math.min(3600, Number((e.target as HTMLInputElement).value) || 10)),
            })
          }
          className="w-20 rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10"
        />
      </div>

      <div className="flex items-center justify-between py-2">
        <label className="text-sm text-white/80">Max rate limit retries</label>
        <input
          type="number"
          min={1}
          max={100}
          value={settings.cliWorkflow.maxRateLimitRetries}
          onChange={(e) =>
            applyCliWorkflowUpdate({
              maxRateLimitRetries: Math.max(1, Math.min(100, Number((e.target as HTMLInputElement).value) || 5)),
            })
          }
          className="w-20 rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10"
        />
      </div>

      {settings.cliWorkflow.executionMode === "DOCKER" && (
        <DockerCredentialsSection
          workflow={settings.cliWorkflow}
          onChange={applyCliWorkflowUpdate}
        />
      )}

      <p className="text-[11px] text-slate-500">
        Recommended default: keep failed worktrees for recovery and disable automatic cleanup on failure.
      </p>
    </SettingsCard>
  );
};
