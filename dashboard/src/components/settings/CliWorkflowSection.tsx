import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { updateCliWorkflow } from "../../lib/settings-updaters.js";
import { executionModeOptions } from "./settings-options.js";
import { FieldLabel, SettingsCard, ToggleRow } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";

export const CliWorkflowSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard
    title="CLI Workflow"
    description="Controls background Gemini/Codex/Claude Code worktree lifecycle and retry behavior."
  >
    <label className="block space-y-2">
      <FieldLabel>Execution Mode</FieldLabel>
      <select
        value={settings.cliWorkflow.executionMode}
        onChange={(event) =>
          onChange(updateCliWorkflow(settings, {
            executionMode: event.currentTarget.value as DashboardSettings["cliWorkflow"]["executionMode"],
          }))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      >
        {executionModeOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>

    <ToggleRow
      label="Cleanup worktree on success"
      checked={settings.cliWorkflow.cleanupWorktreeOnSuccess}
      onToggle={(checked) =>
        onChange(updateCliWorkflow(settings, {
          cleanupWorktreeOnSuccess: checked,
        }))
      }
    />
    <ToggleRow
      label="Cleanup worktree on failure"
      checked={settings.cliWorkflow.cleanupWorktreeOnFailure}
      onToggle={(checked) =>
        onChange(updateCliWorkflow(settings, {
          cleanupWorktreeOnFailure: checked,
        }))
      }
    />
    <ToggleRow
      label="Retry once on `read_file` not found"
      checked={settings.cliWorkflow.retryOnReadFileNotFound}
      onToggle={(checked) =>
        onChange(updateCliWorkflow(settings, {
          retryOnReadFileNotFound: checked,
        }))
      }
    />
    <ToggleRow
      label="Resume failed task in same workspace"
      checked={settings.cliWorkflow.resumeFailedTaskInSameWorkspace}
      onToggle={(checked) =>
        onChange(updateCliWorkflow(settings, {
          resumeFailedTaskInSameWorkspace: checked,
        }))
      }
    />

    {settings.cliWorkflow.executionMode === "DOCKER" && (
      <div className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
        <label className="block space-y-2">
          <FieldLabel>Container Image</FieldLabel>
          <input
            type="text"
            value={settings.cliWorkflow.containerImage}
            onInput={(event) =>
              onChange(updateCliWorkflow(settings, {
                containerImage: event.currentTarget.value,
              }))
            }
            placeholder="node:24-bookworm"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          />
        </label>

        <label className="block space-y-2">
          <FieldLabel>Setup Script Path (optional)</FieldLabel>
          <input
            type="text"
            value={settings.cliWorkflow.containerSetupScriptPath}
            onInput={(event) =>
              onChange(updateCliWorkflow(settings, {
                containerSetupScriptPath: event.currentTarget.value,
              }))
            }
            placeholder=".jules-subagents/container/setup.sh"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          />
          <p className="text-[11px] text-slate-500">
            If empty, runtime checks repo/home defaults under <code>.jules-subagents/container/setup.sh</code>.
          </p>
        </label>

        <ToggleRow
          label="Mount user credentials into container"
          checked={settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountCredentials: checked,
            }))
          }
        />
        <ToggleRow
          label="Mount ~/.gitconfig"
          checked={settings.cliWorkflow.containerMountGitConfig}
          disabled={!settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountGitConfig: checked,
            }))
          }
        />
        <ToggleRow
          label="Mount GitHub CLI auth"
          checked={settings.cliWorkflow.containerMountGithubAuth}
          disabled={!settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountGithubAuth: checked,
            }))
          }
        />
        <ToggleRow
          label="Mount Gemini auth"
          checked={settings.cliWorkflow.containerMountGeminiAuth}
          disabled={!settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountGeminiAuth: checked,
            }))
          }
        />
        <ToggleRow
          label="Mount Codex auth"
          checked={settings.cliWorkflow.containerMountCodexAuth}
          disabled={!settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountCodexAuth: checked,
            }))
          }
        />
        <ToggleRow
          label="Mount Claude Code auth"
          checked={settings.cliWorkflow.containerMountClaudeCodeAuth}
          disabled={!settings.cliWorkflow.containerMountCredentials}
          onToggle={(checked) =>
            onChange(updateCliWorkflow(settings, {
              containerMountClaudeCodeAuth: checked,
            }))
          }
        />

        <div className="grid grid-cols-1 gap-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">GitHub auth path</span>
            <input
              type="text"
              value={settings.cliWorkflow.containerGithubAuthPath}
              disabled={!settings.cliWorkflow.containerMountCredentials || !settings.cliWorkflow.containerMountGithubAuth}
              onInput={(event) =>
                onChange(updateCliWorkflow(settings, {
                  containerGithubAuthPath: event.currentTarget.value,
                }))
              }
              placeholder="~/.config/gh"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Gemini auth path</span>
            <input
              type="text"
              value={settings.cliWorkflow.containerGeminiAuthPath}
              disabled={!settings.cliWorkflow.containerMountCredentials || !settings.cliWorkflow.containerMountGeminiAuth}
              onInput={(event) =>
                onChange(updateCliWorkflow(settings, {
                  containerGeminiAuthPath: event.currentTarget.value,
                }))
              }
              placeholder="~/.gemini"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Codex auth path</span>
            <input
              type="text"
              value={settings.cliWorkflow.containerCodexAuthPath}
              disabled={!settings.cliWorkflow.containerMountCredentials || !settings.cliWorkflow.containerMountCodexAuth}
              onInput={(event) =>
                onChange(updateCliWorkflow(settings, {
                  containerCodexAuthPath: event.currentTarget.value,
                }))
              }
              placeholder="~/.codex"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Claude Code auth path</span>
            <input
              type="text"
              value={settings.cliWorkflow.containerClaudeCodeAuthPath}
              disabled={!settings.cliWorkflow.containerMountCredentials || !settings.cliWorkflow.containerMountClaudeCodeAuth}
              onInput={(event) =>
                onChange(updateCliWorkflow(settings, {
                  containerClaudeCodeAuthPath: event.currentTarget.value,
                }))
              }
              placeholder="~/.claude"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
            />
          </label>
        </div>

        <p className="text-[11px] text-slate-500">
          Credential mounts are read-only and optional. Leave provider API keys empty if you want system/global auth to be used.
        </p>
      </div>
    )}

    <p className="text-[11px] text-slate-500">
      Recommended default: keep failed worktrees for recovery and disable automatic cleanup on failure.
    </p>
  </SettingsCard>
);
