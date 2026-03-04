import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { FieldLabel, ToggleRow } from "../../settings/primitives.js";

interface DockerCredentialsSectionProps {
  workflow: DashboardSettings["cliWorkflow"];
  onChange: (next: Partial<DashboardSettings["cliWorkflow"]>) => void;
}

export const DockerCredentialsSection: FunctionComponent<DockerCredentialsSectionProps> = ({
  workflow,
  onChange,
}) => (
  <div className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
    <label className="block space-y-2">
      <FieldLabel>Container Image</FieldLabel>
      <input
        type="text"
        value={workflow.containerImage}
        onInput={(event) =>
          onChange({
            containerImage: event.currentTarget.value,
          })
        }
        placeholder="node:24-bookworm"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      />
    </label>

    <label className="block space-y-2">
      <FieldLabel>Setup Script Path (optional)</FieldLabel>
      <input
        type="text"
        value={workflow.containerSetupScriptPath}
        onInput={(event) =>
          onChange({
            containerSetupScriptPath: event.currentTarget.value,
          })
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
      checked={workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountCredentials: checked,
        })
      }
    />
    <ToggleRow
      label="Mount ~/.gitconfig"
      checked={workflow.containerMountGitConfig}
      disabled={!workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountGitConfig: checked,
        })
      }
    />
    <ToggleRow
      label="Mount GitHub CLI auth"
      checked={workflow.containerMountGithubAuth}
      disabled={!workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountGithubAuth: checked,
        })
      }
    />
    <ToggleRow
      label="Mount Gemini auth"
      checked={workflow.containerMountGeminiAuth}
      disabled={!workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountGeminiAuth: checked,
        })
      }
    />
    <ToggleRow
      label="Mount Codex auth"
      checked={workflow.containerMountCodexAuth}
      disabled={!workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountCodexAuth: checked,
        })
      }
    />
    <ToggleRow
      label="Mount Claude Code auth"
      checked={workflow.containerMountClaudeCodeAuth}
      disabled={!workflow.containerMountCredentials}
      onToggle={(checked) =>
        onChange({
          containerMountClaudeCodeAuth: checked,
        })
      }
    />

    <div className="grid grid-cols-1 gap-2">
      <label className="block space-y-1">
        <span className="text-[11px] text-slate-500">GitHub auth path</span>
        <input
          type="text"
          value={workflow.containerGithubAuthPath}
          disabled={!workflow.containerMountCredentials || !workflow.containerMountGithubAuth}
          onInput={(event) =>
            onChange({
              containerGithubAuthPath: event.currentTarget.value,
            })
          }
          placeholder="~/.config/gh"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-slate-500">Gemini auth path</span>
        <input
          type="text"
          value={workflow.containerGeminiAuthPath}
          disabled={!workflow.containerMountCredentials || !workflow.containerMountGeminiAuth}
          onInput={(event) =>
            onChange({
              containerGeminiAuthPath: event.currentTarget.value,
            })
          }
          placeholder="~/.gemini"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-slate-500">Codex auth path</span>
        <input
          type="text"
          value={workflow.containerCodexAuthPath}
          disabled={!workflow.containerMountCredentials || !workflow.containerMountCodexAuth}
          onInput={(event) =>
            onChange({
              containerCodexAuthPath: event.currentTarget.value,
            })
          }
          placeholder="~/.codex"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-slate-500">Claude Code auth path</span>
        <input
          type="text"
          value={workflow.containerClaudeCodeAuthPath}
          disabled={!workflow.containerMountCredentials || !workflow.containerMountClaudeCodeAuth}
          onInput={(event) =>
            onChange({
              containerClaudeCodeAuthPath: event.currentTarget.value,
            })
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
);
