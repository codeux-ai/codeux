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
        label="Resume failed task in same workspace"
        checked={settings.cliWorkflow.resumeFailedTaskInSameWorkspace}
        onToggle={(resumeFailedTaskInSameWorkspace) =>
          applyCliWorkflowUpdate({ resumeFailedTaskInSameWorkspace })
        }
      />

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
