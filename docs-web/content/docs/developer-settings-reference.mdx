# Settings schema reference

This page enumerates every settings field, its type, default, range (if applicable), and the JSON path you would use with `manage_settings` → `patch_*_setting`.

Settings are evaluated in cascade: **System → Project → Sprint** (with built-in defaults folded into System). Higher-level fields override lower; unspecified fields inherit. Effective settings API responses include a `sources` object mapping JSON paths to their originating scope (`system`, `project`, or `sprint`).

## Top-level structure

```jsonc
{
  "aiProvider": { /* providers + routing */ },
  "techstackCatalog": { /* system catalog */ },
  "techstack": { /* project selection */ },
  "workers":    { /* virtual worker config */ },
  "ciIntelligence": { /* CI gate */ },
  "automationLevel": "FULL" | "SEMI_AUTO" | "ALWAYS_ASK",
  "automationInterventions": { /* auto-handle action-required states */ },
  "sprintLoopSteps": { /* watch loop tunables */ },
  "cliWorkflow": { /* CLI workflow behavior */ },
  "sprintPreview": { /* preview container settings */ },
  "git": { /* branches, schemes, GitHub mode */ },
  "agents": {
    "selfReflection": {
      "planning": { /* default-off reflection loop */ },
      "qualityAssurance": { /* default-off reflection loop */ }
    }
  },
  "skills": [ /* internal skill toggles */ ],
  "mcpTools": [ /* per-tool enabled flags */ ],
  "memory": { /* embedding model */ },
  "appearance": { /* theme, navigation */ },
  "maxFailures": 5,
  "dashboardPort": 4444,
  "consoleLogLevel": "info",
  "debugLogFileLevel": "error",
  "consoleLogMode": "standard"
}
```

## `aiProvider`

```jsonc
{
  "strategy": "MANUAL" | "WEIGHTED" | "ORCHESTRATOR",
  "providers": {
    "<configId>": {
      "provider": "jules"|"gemini"|"codex"|"claude-code"|"qwen-code"|"opencode"|"antigravity",
      "name": "string",
      "enabled": true,
      "model": "string",
      "weight": 0..100,
      "thinkingMode": "SMALL"|"MEDIUM"|"HIGH",
      "apiKey": "string or ${ENV_VAR}",
      "mountAuth": false,
      "authPath": "string",
      "authType": "apiKey" | "localAuth" | "dashboardAuth",
      "qwenAuthMode": "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER",
      "openCodeAuthMode": "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER",
      "maxConcurrentTasks": 0    // 0 = unlimited
    }
  },
  "routing": {
    "<routingId>": {
      "providerConfigId": "string",
      "agentPresetId": "string?",
      "profile": "GLOBAL" | "WORKER"
    }
  }
}
```

`<routingId>` ∈ `task_coding | planning | dashboard_reply | clarification_reply | qa_review | ci_fix | merge_conflict`.

### Default providers

| Config ID | Enabled | Model | Weight | Thinking | maxConcurrentTasks |
| --- | --- | --- | --- | --- | --- |
| `jules` | ✅ | `default` | 60 | MEDIUM | 15 |
| `gemini` | ✅ | `default` (`auto`) | 20 | MEDIUM | 0 |
| `codex` | ✅ | `gpt-5.5` | 20 | HIGH | 0 |
| `claude-code` | ❌ | `default` | 0 | HIGH | 0 |
| `qwen-code` | ❌ | `qwen3-coder-plus` | 0 | HIGH | 0 |
| `opencode` | ❌ | `anthropic/claude-sonnet-4-5` | 0 | HIGH | 0 |
| `antigravity` | ❌ | `default` | 0 | HIGH | 0 |

## `techstackCatalog`

System settings own the techstack catalog:

```jsonc
{
  "defaultTechstackId": "code-ux-internal",
  "entries": [
    {
      "id": "code-ux-internal",
      "label": "Code UX Stack",
      "items": [
        { "id": "preact", "label": "Preact" },
        { "id": "tanstack-router", "label": "TanStack Router" },
        { "id": "gsap", "label": "GSAP" },
        { "id": "three-js", "label": "Three.js" },
        { "id": "lucide-icons", "label": "Lucide Icons" }
      ]
    }
  ]
}
```

Saved catalogs are normalized on load. Code UX trims ids and labels, drops malformed or duplicate ids, always preserves the built-in `code-ux-internal` entry, and falls back `defaultTechstackId` to `code-ux-internal` when the saved default is missing or invalid.

## `techstack`

Project and sprint settings own the selected techstack:

```jsonc
{
  "selectedTechstackId": null,
  "applicationKind": null // "web" | "desktop" | null
}
```

Default project settings intentionally keep `selectedTechstackId` and `applicationKind` as `null`. Existing and imported projects therefore do not automatically inherit the built-in Code UX Stack; a project creation flow must set an explicit override when it wants to apply the catalog default.

## `designGuidance`

Project and sprint settings own design guidance:

```jsonc
{
  "selectedTechStackId": "none",
  "selectedStyleguideId": "none",
  "hideDefaultStyleguides": false,
  "customTechStacks": [
    {
      "id": "custom-stack",
      "name": "Custom Stack",
      "summary": "Concise summary",
      "instructionMarkdown": "Project-specific stack guidance."
    }
  ],
  "customStyleguides": []
}
```

The backend catalog always includes `none`, the built-in `Code UX` styleguide, additional default styleguides, and a small tech-stack guidance catalog. Saved selections resolve to a known default or custom id; invalid ids fall back to `none`. `hideDefaultStyleguides` only affects presentation and does not remove backend defaults. Existing and imported projects inherit `none`; new local and new remote project initialization writes an explicit project override for the Code UX styleguide. Planning and Project Setup prompts resolve selected entries from effective project settings and omit inactive `none` catalog entries. Project Setup prompts also include a setup-only styling investigation notice whenever the styleguide selection is `none`, including when tech-stack guidance is also `none`.

The dashboard Guidance panel manages this block through the normal settings save flows. System scope edits `system.defaults.designGuidance`; project scope edits the active project override. Built-in catalog entries can be selected but cannot be edited or deleted. Custom entries can be added, edited, and deleted; deleting a selected custom entry clears that selector back to `none`.

## `cliWorkflow`

```jsonc
{
  "gitMode": "remote" | "local",
  "executionMode": "DOCKER",
  "containerImageMode": "managed" | "custom",
  "containerImage": "node:24-trixie-slim",
  "containerSetupScriptPath": "string?",
  "containerMemoryLimitMb": 6144,
  "containerRunAsRoot": false
}
```

Default `gitMode`: `remote`. Default `executionMode`: `DOCKER`.
Default `containerImageMode`: `managed`. Managed mode checks the Code UX runtime for updates on each startup and executes verified immutable digests; `containerImage` is used only in custom mode. Untouched legacy `node:24-bookworm` settings migrate to managed mode, while other legacy images remain custom.
`containerMemoryLimitMb` is a MiB ceiling for every Docker-backed CLI provider container. Positive values are passed to Docker as both `--memory` and `--memory-swap`; set it to `0` to omit Docker memory flags.
`containerRunAsRoot` is an opt-in runtime mode for Docker provider containers that must run as root. It defaults to `false`, and invalid or missing settings sanitize back to `false`; otherwise provider containers run with the resolved host workspace UID/GID and receive a matching mounted `/etc/passwd` worker entry. Settings > General > Docker Runtime exposes this setting for system defaults and project-scoped overrides. A resolved worker agent preset can override this value for local CLI task execution with nullable `containerRunAsRoot`; `null` or omission inherits the scoped setting, `false` forces non-root, `true` forces root, and hosted Jules sessions ignore the preset field. Root mode is privileged and should be reserved for trusted repositories that require package-manager or OS-level writes inside the provider container. Provider containers use Docker bridge networking without published ports and keep managed labels for cleanup. Loopback MCP URLs are rewritten to `host.docker.internal`; Linux Docker Engine runs with loopback MCP endpoints also add `--add-host host.docker.internal:host-gateway` unless `CODE_UX_DOCKER_REWRITE_LOCALHOST=0` opts out.

`containerInstallPlaywrightBrowsers` defaults to `true` and selects the prebuilt managed browser image. Provider CLIs are prepared separately in versioned read-only volumes and checked for stable updates on startup.

## `sprintPreview`

```jsonc
{
  "enabled": false,
  "startupScriptPath": ".code-ux/browser/start-preview.sh"
}
```

## `workers`

```jsonc
{
  "virtualWorkerProvider": "gemini"|"codex"|"claude-code"|"qwen-code"|"opencode"|"antigravity"
}
```

Default `virtualWorkerProvider`: `codex`.

## `ciIntelligence`

```jsonc
{
  "enabled": true,
  "enableLivePrMonitoring": true,
  "resolveAllCommentsBeforeMainMerge": true,
  "resolveAllCommentsBeforeFeatureMerge": true,
  "resolveMergeConflicts": true,
  "resolveMainMergeConflicts": true,
  "waitForJulesCiAutofix": false,
  "julesCiAutofixMaxRetries": 3,           // min 0, max 20
  "featurePrAutoMergeMode": "OFF" | "CREATE_PR" | "WHEN_GREEN" | "ALWAYS",
  "mainBranchAutoMergeMode": "OFF" | "CREATE_PR" | "WHEN_GREEN" | "ALWAYS"
}
```

Defaults: `featurePrAutoMergeMode = ALWAYS`, `mainBranchAutoMergeMode = CREATE_PR`.

## `automationLevel`

```jsonc
"automationLevel": "SEMI_AUTO"   // FULL | SEMI_AUTO | ALWAYS_ASK
```

Default: `SEMI_AUTO`.

## `automationInterventions`

```jsonc
{
  "autoApprovePlan": true,
  "autoAnswerClarification": false,
  "autoAnswerClarificationMode": "TEMPLATE" | "WORKER",
  "autoResumePaused": false,
  "clarificationAnswerTemplate": "Proceed with the safest implementation path...",
  "clarificationCooldownSeconds": 300
}
```

## `sprintLoopSteps`

```jsonc
{
  "branchPreflight": true,
  "planningPreflight": true,
  "loadSubtasks": true,
  "sessionSync": true,
  "statusDerivation": true,
  "startReadyTasks": true,
  "mergeProtocol": true,
  "actionRequiredProtocol": true,
  "statusTable": true,
  "watchLoop": true,
  "watchLoopIntervalSeconds": 10,         // min 1, max 3600
  "watchLoopOutputIntervalSeconds": 300    // min 60, max 3600
}
```

Disabling a step is for debugging; in production, leave them all enabled.

## `git`

```jsonc
{
  "defaultBranch": "main",
  "featureBranchPrefix": "feature/codeux/",
  "sprintBranchScheme": "feature/sprint{sprint_id}-implementation",
  "sprintKeyPrefix": "SPR",
  "taskPrTitleScheme": "({sprint_tag}) {task_title}",
  "githubMode": "REMOTE" | "LOCAL",
  "deleteMergedBranches": true,
  "autoCreatePr": true,
  "prDescription": { /* task and sprint PR template toggles */ }
}
```

`git.taskPrTitleScheme` controls automated task PR titles for initial task PR creation
and QA follow-up PR resolution. Its default is `({sprint_tag}) {task_title}`. Supported tokens are
`{sprint_tag}`, `{sprint_key}`, `{sprint_number}`, `{sprint_title}`, `{task_key}`,
`{task_title}`, and `{provider}`. `{sprint_tag}` resolves in this order: first linked issue key
when present, then `<sprintKeyPrefix>-<sprint number>`, then a stable sprint slug/id fallback.
Provider text is included only when the template contains `{provider}`.

`deleteMergedBranches` (default `true`) deletes a branch once its work has merged: worker
branches after they merge into the sprint feature branch, and the feature branch after it merges
into the default branch. In REMOTE mode PR merges already delete the remote branch; this primarily
governs LOCAL-mode cleanup. A startup reaper also removes already-merged Code UX-managed branches
(`task/…` and `<featureBranchPrefix>…`) so long-lived repos don't accumulate thousands of dead
branches — only branches fully contained in the default branch are removed.

## `skills`

```jsonc
[
  { "name": "git_manager",         "enabled": true,  "isInternal": true },
  { "name": "git_manager_remote",  "enabled": true,  "isInternal": true },
  { "name": "git_manager_local",   "enabled": false, "isInternal": true }
]
```

These are internal skills toggleable for advanced workflows. Most users should not touch them.

## `agents.selfReflection`

```jsonc
{
  "planning": {
    "enabled": false,
    "criteria": [
      { "id": "correctness", "label": "Correctness", "prompt": "...", "threshold": 0.85 },
      { "id": "scope_control", "label": "Scope control", "prompt": "...", "threshold": 0.85 }
    ],
    "maxImprovementAttempts": 1
  },
  "qualityAssurance": {
    "enabled": false,
    "criteria": [
      { "id": "correctness", "label": "Correctness", "prompt": "...", "threshold": 0.85 }
    ],
    "maxImprovementAttempts": 1
  }
}
```

Both reflection loops are disabled by default. When enabled, planning and QA structured responses are rated against the configured criteria and can request an improved JSON payload before acceptance; invalid reflection output fails open to the last valid parsed response. Criteria are senior engineering checks such as correctness, completeness, decomposition quality, risk handling, testability, maintainability, security, and scope control. Sanitization dedupes criteria by `id`, clamps thresholds to `0..1`, clamps `maxImprovementAttempts` to `0..10`, and falls back to defaults for malformed legacy payloads.

## `mcpTools`

```jsonc
[
  { "name": "manage_projects",     "enabled": true, "isInternal": true },
  { "name": "manage_sprints",      "enabled": true, "isInternal": true },
  { "name": "manage_tasks",        "enabled": true, "isInternal": true },
  { "name": "manage_quicksprints", "enabled": true, "isInternal": true },
  { "name": "manage_scheduler",    "enabled": true, "isInternal": true },
  { "name": "manage_agents",       "enabled": true, "isInternal": true },
  { "name": "manage_node_flows",   "enabled": true, "isInternal": true },
  { "name": "manage_memory",       "enabled": true, "isInternal": true },
  { "name": "search_knowledge",    "enabled": true, "isInternal": true },
  { "name": "manage_settings",     "enabled": true, "isInternal": true },
  { "name": "manage_preview",      "enabled": true, "isInternal": true },
  { "name": "manage_chat_providers", "enabled": true, "isInternal": true },
  { "name": "manage_telemetry",    "enabled": true, "isInternal": true },
  { "name": "manage_code_ux",      "enabled": true, "isInternal": true }   // deprecated
]
```

Disable a tool to hide it from `ListTools` and reject `CallTool` invocations.

## `memory`

```jsonc
{
  "activeEmbeddingModelId": "string",
  "promotion": {
    "enabled": true,
    "scoreThreshold": 0.6
  }
}
```

## `appearance`

```jsonc
{
  "experienceMode": "EASY" | "STANDARD" | "EXPERT",
  "theme": "SYSTEM" | "LIGHT" | "DARK",
  "navigationMode": "DOCK" | "SIDEBAR"
}
```

## `maxFailures`

```jsonc
"maxFailures": 5
```

Emergency stop threshold (consecutive task-start failures). Override via env: `JULES_API_MAX_FAILS`.

## Patching examples

```jsonc
// Set the Codex model to gpt-5.4 system-wide
// 1. First call (unconfirmed) - returns approvalRequired: true
{ "domain": "settings", "action": "patch_system_setting",
  "payload": { "path": "aiProvider.providers.codex.model", "value": "gpt-5.4" } }

// 2. Second call (confirmed) - executes if within 15 minutes and exact same payload
{ "domain": "settings", "action": "patch_system_setting",
  "payload": { "path": "aiProvider.providers.codex.model", "value": "gpt-5.4" },
  "approval": { "confirmed": true } }

// For one project, force WHEN_GREEN auto-merge
// 1. First call (unconfirmed)
{ "domain": "settings", "action": "patch_project_setting",
  "payload": { "projectId": "proj-1", "path": "ciIntelligence.featurePrAutoMergeMode", "value": "WHEN_GREEN" } }

// 2. Second call (confirmed)
{ "domain": "settings", "action": "patch_project_setting",
  "payload": { "projectId": "proj-1", "path": "ciIntelligence.featurePrAutoMergeMode", "value": "WHEN_GREEN" },
  "approval": { "confirmed": true } }

// For one sprint, route planning to Claude Opus
// 1. First call (unconfirmed)
{ "domain": "settings", "action": "patch_sprint_setting",
  "payload": {
    "projectId": "proj-1", "sprintId": "spr-3",
    "path": "aiProvider.routing.planning",
    "value": { "providerConfigId": "claude-code", "profile": "GLOBAL" }
  } }

// 2. Second call (confirmed)
{ "domain": "settings", "action": "patch_sprint_setting",
  "payload": {
    "projectId": "proj-1", "sprintId": "spr-3",
    "path": "aiProvider.routing.planning",
    "value": { "providerConfigId": "claude-code", "profile": "GLOBAL" }
  },
  "approval": { "confirmed": true } }
```

## Validation

All settings are validated against TypeScript types and runtime AJV schemas. Invalid values:

- Reject the patch with `VALIDATION` error.
- Never partially apply.
- Surface a precise JSON path in the error message.
