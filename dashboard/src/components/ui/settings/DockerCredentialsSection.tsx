import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import type { FieldDescriptor } from "../../settings/field-descriptors.js";
import { SettingsFieldRenderer } from "../../settings/SettingsFieldRenderer.js";

interface DockerCredentialsSectionProps {
  workflow: DashboardSettings["cliWorkflow"];
  onChange: (next: Partial<DashboardSettings["cliWorkflow"]>) => void;
}

const topDescriptors: FieldDescriptor<DashboardSettings["cliWorkflow"]>[] = [
  {
    id: "containerImage",
    type: "input",
    label: "Container Image",
    placeholder: "node:24-bookworm",
    getValue: (workflow) => workflow.containerImage,
    onInput: (workflow, value) => ({ ...workflow, containerImage: value }),
  },
  {
    id: "containerSetupScriptPath",
    type: "input",
    label: "Setup Script Path (optional)",
    placeholder: ".sprint-os/container/setup.sh",
    description: "If empty, runtime checks repo/home defaults under `.sprint-os/container/setup.sh`.",
    getValue: (workflow) => workflow.containerSetupScriptPath,
    onInput: (workflow, value) => ({ ...workflow, containerSetupScriptPath: value }),
  },
  {
    id: "containerCacheSetupScriptImage",
    type: "toggle",
    label: "Cache setup as image",
    description: "Build and reuse a derived image from the base image and setup script contents.",
    getValue: (workflow) => workflow.containerCacheSetupScriptImage,
    onToggle: (workflow, checked) => ({ ...workflow, containerCacheSetupScriptImage: checked }),
  },
];

const toggleDescriptors: FieldDescriptor<DashboardSettings["cliWorkflow"]>[] = [
  {
    id: "containerMountGitConfig",
    type: "toggle",
    label: "Mount ~/.gitconfig",
    getValue: (workflow) => workflow.containerMountGitConfig,
    onToggle: (workflow, checked) => ({ ...workflow, containerMountGitConfig: checked }),
  },
  {
    id: "containerMountGithubAuth",
    type: "toggle",
    label: "Mount GitHub CLI auth",
    getValue: (workflow) => workflow.containerMountGithubAuth,
    onToggle: (workflow, checked) => ({ ...workflow, containerMountGithubAuth: checked }),
  },
  {
    id: "containerMountGeminiAuth",
    type: "toggle",
    label: "Mount Gemini auth",
    getValue: (workflow) => workflow.containerMountGeminiAuth,
    onToggle: (workflow, checked) => ({ ...workflow, containerMountGeminiAuth: checked }),
  },
  {
    id: "containerMountCodexAuth",
    type: "toggle",
    label: "Mount Codex auth",
    getValue: (workflow) => workflow.containerMountCodexAuth,
    onToggle: (workflow, checked) => ({ ...workflow, containerMountCodexAuth: checked }),
  },
  {
    id: "containerMountClaudeCodeAuth",
    type: "toggle",
    label: "Mount Claude Code auth",
    getValue: (workflow) => workflow.containerMountClaudeCodeAuth,
    onToggle: (workflow, checked) => ({ ...workflow, containerMountClaudeCodeAuth: checked }),
  },
];

const pathInputDescriptors: FieldDescriptor<DashboardSettings["cliWorkflow"]>[] = [
  {
    id: "containerGithubAuthPath",
    type: "input",
    label: "GitHub auth path",
    placeholder: "~/.config/gh",
    disabled: (workflow) => !workflow.containerMountGithubAuth,
    getValue: (workflow) => workflow.containerGithubAuthPath,
    onInput: (workflow, value) => ({ ...workflow, containerGithubAuthPath: value }),
  },
  {
    id: "containerGeminiAuthPath",
    type: "input",
    label: "Gemini auth path",
    placeholder: "~/.gemini",
    disabled: (workflow) => !workflow.containerMountGeminiAuth,
    getValue: (workflow) => workflow.containerGeminiAuthPath,
    onInput: (workflow, value) => ({ ...workflow, containerGeminiAuthPath: value }),
  },
  {
    id: "containerCodexAuthPath",
    type: "input",
    label: "Codex auth path",
    placeholder: "~/.codex",
    disabled: (workflow) => !workflow.containerMountCodexAuth,
    getValue: (workflow) => workflow.containerCodexAuthPath,
    onInput: (workflow, value) => ({ ...workflow, containerCodexAuthPath: value }),
  },
  {
    id: "containerClaudeCodeAuthPath",
    type: "input",
    label: "Claude Code auth path",
    placeholder: "~/.claude",
    disabled: (workflow) => !workflow.containerMountClaudeCodeAuth,
    getValue: (workflow) => workflow.containerClaudeCodeAuthPath,
    onInput: (workflow, value) => ({ ...workflow, containerClaudeCodeAuthPath: value }),
  },
];

export const DockerCredentialsSection: FunctionComponent<DockerCredentialsSectionProps> = ({
  workflow,
  onChange,
}) => (
  <div className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
    {topDescriptors.map((descriptor) => (
      <SettingsFieldRenderer
        key={descriptor.id}
        descriptor={descriptor}
        context={workflow}
        onChange={onChange}
      />
    ))}

    {toggleDescriptors.map((descriptor) => (
      <SettingsFieldRenderer
        key={descriptor.id}
        descriptor={descriptor}
        context={workflow}
        onChange={onChange}
      />
    ))}

    <div className="grid grid-cols-1 gap-2">
      {pathInputDescriptors.map((descriptor) => (
        <SettingsFieldRenderer
          key={descriptor.id}
          descriptor={descriptor}
          context={workflow}
          onChange={onChange}
          className="block space-y-1 [&_span]:text-[11px] [&_span]:text-slate-500 [&_input]:px-2 [&_input]:py-1.5 [&_input]:text-xs"
        />
      ))}
    </div>

    <p className="text-[11px] text-slate-500">
      Credential mounts are read-only and optional. Enable the provider-specific toggle you want to sync into Docker.
    </p>
  </div>
);
