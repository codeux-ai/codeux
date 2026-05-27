import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { ProjectSetupOptions, ProjectSummary } from "../contracts/project-management-types.js";

export interface ProjectSetupPromptArgs {
  project: ProjectSummary;
  setupAgent: AgentPresetRecord;
  options: ProjectSetupOptions;
}

const requestedArtifacts = (options: ProjectSetupOptions): string[] => {
  const artifacts: string[] = [];
  if (options.agents) artifacts.push("Agents");
  if (options.quicksprints) artifacts.push("Quicksprint Templates");
  if (options.previewScript) artifacts.push("Preview Container Script");
  if (options.ci) artifacts.push("GitHub/GitLab CI");
  return artifacts;
};

export function buildDefaultProjectSetupAgentInstructions(): string {
  return [
    "You are Code UX's Project Setup Agent.",
    "",
    "Your responsibility is to initialize a newly connected repository with senior-level Code UX operating assets that are specific to the real codebase. You must research the repository before designing any artifact.",
    "",
    "Research requirements:",
    "- Inspect the repository tree, package/dependency manifests, build scripts, test scripts, CI files, Docker/container files, framework configuration, source layout, and application entrypoints.",
    "- Read CLI and assistant instruction files wherever present, including AGENTS.md, GEMINI.md, Gemini.md, CLAUDE.md, Claude.md, README.md, docs/**/*.md, package.json, pnpm/npm/yarn/bun lockfiles, turbo/nx/vite/next/remix/svelte/astro/tsconfig/eslint/prettier/vitest/jest/playwright/cypress configs, Dockerfiles, compose files, and existing workflow files.",
    "- Infer the architecture, primary languages, frameworks, runtime commands, test commands, preview startup needs, deployment assumptions, and ownership boundaries from evidence in the repository.",
    "- Do not create generic agents. Each agent must be a specialist for an important part of this exact app, with explicit routing guidance, file/domain ownership, quality bar, constraints, and verification expectations.",
    "",
    "Artifact quality bar:",
    "- Agents must read like senior specialist operating manuals, not role labels. Include responsibilities, when to route to the agent, required discovery steps, implementation rules, architectural constraints, verification commands, and handoff expectations.",
    "- Quicksprints must be reusable project-specific sprint templates that produce actionable work for this architecture.",
    "- Preview startup must boot the actual app reliably in Code UX preview containers using HOST/PORT/SPRINT_PREVIEW_* environment variables and the package manager used by the repo.",
    "- CI must provide basic but useful error checking for the detected stack without requiring unavailable secrets.",
  ].join("\n");
}

export function buildProjectSetupPrompt(args: ProjectSetupPromptArgs): string {
  const selected = requestedArtifacts(args.options);
  return [
    "You are Code UX's Project Setup Agent.",
    "",
    "## Project Setup Agent Instructions",
    args.setupAgent.instructionMarkdown.trim() || buildDefaultProjectSetupAgentInstructions(),
    "",
    "## Task",
    "Research this complete codebase and return a repository-specific setup artifact plan. Code UX will apply the returned JSON to the real project.",
    "",
    `Project: ${args.project.name}`,
    `Repository root: ${args.project.baseDir}`,
    `Source type: ${args.project.sourceType}`,
    `Requested artifacts: ${selected.length > 0 ? selected.join(", ") : "none"}`,
    "",
    "## Mandatory Research Scope",
    "- Start by listing the repository root and identifying the package manager, primary language(s), framework(s), app entrypoints, scripts, and test commands.",
    "- Read all assistant and CLI instruction markdown files that exist, especially AGENTS.md, GEMINI.md, Gemini.md, CLAUDE.md, Claude.md, README.md, docs/**/*.md, and equivalent local convention files.",
    "- Read dependency manifests and configuration that determine architecture or commands, including package.json and relevant workspace/config files.",
    "- Read enough source files to identify the app's important subsystems and boundaries before proposing agents.",
    "",
    "## Output Contract",
    "Return JSON only. Do not wrap it in markdown fences. Do not include commentary outside JSON.",
    "",
    "{",
    '  "summary": "Short evidence-based summary of the detected stack and setup choices.",',
    '  "agents": [',
    "    {",
    '      "name": "Frontend Architecture Agent",',
    '      "description": "One compact routing description.",',
    '      "labels": ["worker"],',
    '      "instructionMarkdown": "Full senior-level instructions tailored to this repository."',
    "    }",
    "  ],",
    '  "quicksprints": [',
    "    {",
    '      "name": "Project-specific quicksprint name",',
    '      "description": "What this template is for.",',
    '      "icon": "Sparkles",',
    '      "category": "engineering",',
    '      "categoryColor": "#22c55e",',
    '      "defaultTaskCount": 5,',
    '      "agentInstructionMarkdown": "Template instructions that force codebase-specific task planning."',
    "    }",
    "  ],",
    '  "previewScript": {',
    '    "path": ".code-ux/browser/start-preview.sh",',
    '    "content": "#!/usr/bin/env bash\\nset -euo pipefail\\n..."',
    "  },",
    '  "ci": [',
    "    {",
    '      "provider": "github",',
    '      "path": ".github/workflows/code-ux-basic-checks.yml",',
    '      "content": "name: Code UX Basic Checks\\n..."',
    "    }",
    "  ]",
    "}",
    "",
    "## Artifact Rules",
    ...(args.options.agents ? [
      "- For agents, create a Project Setup Agent plus senior specialist worker agents for each important architectural area. Include planning/routing hints and verification commands in every instructionMarkdown.",
      "- Include `worker` in labels for coding specialists. Include `planning` only for a planning-specialist agent if you intentionally create one.",
    ] : ["- Set `agents` to an empty array."]),
    ...(args.options.quicksprints ? [
      "- For quicksprints, produce 4 to 8 templates that are specific to this repository's architecture, quality needs, and development workflow.",
    ] : ["- Set `quicksprints` to an empty array."]),
    ...(args.options.previewScript ? [
      "- For previewScript, produce a POSIX shell script for `.code-ux/browser/start-preview.sh` that installs dependencies only when needed, uses the detected package manager, binds to `${PORT:-3000}`, and starts the correct dev/preview server.",
      "- The script must work in a Code UX preview container. Use HOST=0.0.0.0 and respect SPRINT_PREVIEW_PORT, PORT, SPRINT_PREVIEW_WORKSPACE, and SPRINT_PREVIEW_RUN_COMMAND when relevant.",
    ] : ["- Set `previewScript` to null."]),
    ...(args.options.ci ? [
      "- For CI, produce basic GitHub Actions and/or GitLab CI files only when appropriate for the detected repository. Prefer install, lint if present, typecheck if present, test if present, and build if present.",
      "- CI must use the detected package manager and avoid secret-dependent deployment steps.",
    ] : ["- Set `ci` to an empty array."]),
  ].join("\n");
}
