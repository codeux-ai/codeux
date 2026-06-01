# Settings schema reference

This page enumerates every settings field, its type, default, range (if applicable), and the JSON path you would use with `manage_code_ux` → `settings` → `patch_*_setting`.

Settings are evaluated in cascade: **Defaults → System → Project → Sprint**. Higher-level fields override lower; unspecified fields inherit.

## Top-level structure

```jsonc
{
  "aiProvider": { /* providers + routing */ },
  "workers":    { /* virtual worker config */ },
  "ciIntelligence": { /* CI gate */ },
  "automationLevel": "FULL" | "SEMI_AUTO" | "ALWAYS_ASK",
  "automationInterventions": { /* auto-handle action-required states */ },
  "sprintLoopSteps": { /* watch loop tunables */ },
  "git": { /* branches, schemes, GitHub mode */ },
  "skills": [ /* internal skill toggles */ ],
  "mcpTools": [ /* per-tool enabled flags */ ],
  "memory": { /* embedding model */ },
  "appearance": { /* theme, navigation */ },
  "maxFailures": 5
}
```

## `aiProvider`

```jsonc
{
  "strategy": "MANUAL" | "WEIGHTED" | "ORCHESTRATOR",
  "providers": {
    "<configId>": {
      "provider": "jules"|"gemini"|"codex"|"claude-code"|"qwen-code"|"opencode",
      "name": "string",
      "enabled": true,
      "model": "string",
      "weight": 0..100,
      "thinkingMode": "SMALL"|"MEDIUM"|"HIGH",
      "apiKey": "string or ${ENV_VAR}",
      "mountAuth": false,
      "authPath": "string",
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
| `codex` | ✅ | `gpt-5.3-codex` | 20 | HIGH | 0 |
| `claude-code` | ❌ | `default` | 0 | HIGH | 0 |
| `qwen-code` | ❌ | `qwen3-coder-plus` | 0 | HIGH | 0 |
| `opencode` | ❌ | `anthropic/claude-sonnet-4-5` | 0 | HIGH | 0 |

## `workers`

```jsonc
{
  "virtualWorkerProvider": "gemini"|"codex"|"claude-code"|"qwen-code"|"opencode",
  "executionMode": "DOCKER" | "HOST",
  "dockerImage": "node:24-bookworm",
  "containerSetupScript": "string?"
}
```

Default `virtualWorkerProvider`: `codex`. Default `executionMode`: `DOCKER`.

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
  "branchScheme": { /* DEFAULT_SPRINT_BRANCH_SCHEME */ },
  "githubMode": "REMOTE" | "LOCAL"
}
```

## `skills`

```jsonc
[
  { "name": "git_manager",         "enabled": true,  "isInternal": true },
  { "name": "git_manager_remote",  "enabled": true,  "isInternal": true },
  { "name": "git_manager_local",   "enabled": false, "isInternal": true }
]
```

These are internal skills toggleable for advanced workflows. Most users should not touch them.

## `mcpTools`

```jsonc
[
  { "name": "get_session",                 "enabled": true, "isInternal": true },
  { "name": "manage_code_ux",              "enabled": true, "isInternal": true },
  { "name": "listen",                      "enabled": true, "isInternal": true },
  { "name": "start_listen",                "enabled": true, "isInternal": true },
  { "name": "pull_inbox",                  "enabled": true, "isInternal": true },
  { "name": "post_listen_reply",           "enabled": true, "isInternal": true },
  { "name": "generate_dashboard_reply",    "enabled": true, "isInternal": true }
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
  "theme": "system" | "light" | "dark",
  "navigationMode": "auto" | "dock" | "sidebar",
  "density": "comfortable" | "compact"
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
{ "domain": "settings", "action": "patch_system_setting",
  "payload": { "path": "aiProvider.providers.codex.model", "value": "gpt-5.4" },
  "approval": { "confirmed": true } }

// For one project, force WHEN_GREEN auto-merge
{ "domain": "settings", "action": "patch_project_setting",
  "payload": { "projectId": "proj-1", "path": "ciIntelligence.featurePrAutoMergeMode", "value": "WHEN_GREEN" } }

// For one sprint, route planning to Claude Opus
{ "domain": "settings", "action": "patch_sprint_setting",
  "payload": {
    "projectId": "proj-1", "sprintId": "spr-3",
    "path": "aiProvider.routing.planning",
    "value": { "providerConfigId": "claude-code", "profile": "GLOBAL" }
  } }
```

## Validation

All settings are validated against TypeScript types and runtime AJV schemas. Invalid values:

- Reject the patch with `VALIDATION` error.
- Never partially apply.
- Surface a precise JSON path in the error message.
