# Atomic Refactor Documentation

## Scope
This document describes the refactor that introduces:
- Atomic sprint-loop architecture with independent step toggles.
- Separation of MCP core tool logic and agent tool logic.
- Editable markdown instruction templates with placeholder parsing.
- Home directory migration from `~/jules-subagents` to `~/.jules-subagents`.
- Dashboard settings for CI Intelligence merge gates.

## What Changed

### 1. Home Directory Path Migration
The canonical runtime directory is now:
- `~/.jules-subagents`

Legacy path support:
- If `~/.jules-subagents/settings.db` does not exist and `~/jules-subagents/settings.db` exists, the DB is copied forward automatically.
- Runtime code now resolves to the dot-directory by default.

Relevant file:
- `src/settings-repository.ts`

### 2. Main MCP Atomic Split
The MCP server no longer keeps all tool logic in one class.

New handler modules:
- `src/mcp/core-tool-handler.ts`
  - Jules API tool behavior: source/session/activity tools, wait logic, create-session safety.
- `src/mcp/agent-tool-handler.ts`
  - Agent behavior: `sprint_agent` and `task_agent` orchestration entrypoints.

Runtime composition:
- `src/index.ts` now composes specialized handlers instead of embedding every handler implementation inline.

### 3. Sprint Main Loop Atomic Design
The sprint loop is decomposed into explicit step modules.

Step modules:
- `src/sprint/steps/branch-preflight-step.ts`
- `src/sprint/steps/planning-preflight-step.ts`
- `src/sprint/steps/load-subtasks-step.ts`
- `src/sprint/steps/session-sync-step.ts`
- `src/sprint/steps/status-derivation-step.ts`
- `src/sprint/steps/start-ready-tasks-step.ts`
- `src/sprint/steps/protocol-step.ts`
- `src/sprint/steps/status-table-step.ts`
- `src/sprint/steps/completion-step.ts`

Main orchestrator entrypoint:
- `src/sprint-orchestrator.ts`

The orchestrator now executes these steps in sequence, and each step can be toggled on/off via dashboard settings.

### 4. Agent Logic vs Loop Logic Separation
Agent invocation flow is separated from loop internals:
- Agent entry and tool contracts are handled in `src/mcp/agent-tool-handler.ts`.
- Loop internals are in `src/sprint-orchestrator.ts` and `src/sprint/steps/*`.
- Shared sprint input types are in `src/sprint/types.ts`.

This makes loop behavior reorderable/editable without touching MCP tool plumbing.

## Editable Instruction System

### 1. Directory Layout
Instruction templates are now expected at:
- `.jules-subagents/instructions/**`

Current sprint loop templates:
- `.jules-subagents/instructions/sprint-main-loop/guards/*`
- `.jules-subagents/instructions/sprint-main-loop/planning/*`
- `.jules-subagents/instructions/sprint-main-loop/protocol/*`
- `.jules-subagents/instructions/sprint-main-loop/watch/*`
- `.jules-subagents/instructions/sprint-main-loop/cleanup/*`

Compatibility alias:
- `.jules-subagents/intructions/**` is also supported as a fallback search path for typo-safe compatibility.

### 2. Placeholder Engine
Template placeholder syntax:
- `{{placeholder}}`
- Nested values: `{{group.key}}`

Implementation:
- `src/instructions/template-engine.ts`

Repository lookup + fallback:
- `src/instructions/repository.ts`
  - Search precedence: repo path, current working directory, project root, home.
- `src/instructions/service.ts`
  - Uses file template if present.
  - Falls back to built-in defaults in `src/instructions/catalog.ts`.

### 3. Instruction Catalog
Template IDs and default markdown mappings are centralized in:
- `src/instructions/catalog.ts`

Sprint orchestrator calls instruction templates by ID for:
- Branch missing preflight blocker.
- Planning missing blocker.
- Planning created guidance.
- Merge protocol items.
- Action-required protocol items.
- Watch header/termination messaging.
- Cleanup and sprint completion messaging.

## Dashboard Settings Additions

## CI Intelligence
Added settings group:
- `ciIntelligence.enabled`
- `ciIntelligence.waitForCiBeforeMainMerge`
- `ciIntelligence.resolveAllCommentsBeforeMainMerge`
- `ciIntelligence.waitForCiBeforeFeatureMerge`
- `ciIntelligence.resolveAllCommentsBeforeFeatureMerge`

These toggles influence generated orchestration protocol instructions for both feature-branch merges and final main-branch merge guidance.

## Sprint Loop Steps
Added settings group:
- `sprintLoopSteps.branchPreflight`
- `sprintLoopSteps.planningPreflight`
- `sprintLoopSteps.loadSubtasks`
- `sprintLoopSteps.sessionSync`
- `sprintLoopSteps.statusDerivation`
- `sprintLoopSteps.startReadyTasks`
- `sprintLoopSteps.mergeProtocol`
- `sprintLoopSteps.actionRequiredProtocol`
- `sprintLoopSteps.statusTable`
- `sprintLoopSteps.watchLoop`

Behavior:
- Each step is independently enable/disable capable.
- If watch mode is requested while `watchLoop` is disabled, the orchestrator runs a single cycle and emits a note.

## Settings Persistence and Types
Backend settings types:
- `src/types.ts`

Dashboard settings types:
- `dashboard/src/types.ts`

Backend defaults + sanitization:
- `src/settings-repository.ts`

Dashboard defaults:
- `dashboard/src/lib/settings.ts`

Dashboard UI controls:
- `dashboard/src/components/SettingsPage.tsx`

## Test Coverage Added/Updated

New tests:
- `src/instructions/template-engine.test.ts`
- `src/instructions/service.test.ts`

Updated tests:
- `src/sprint-orchestrator.test.ts`
- `src/settings-repository.test.ts`

Validation run:
- `npm test` passed.
- `npm run build` passed (server typecheck + dashboard typecheck/build).

## Operational Notes

1. Existing projects can now override sprint loop messaging entirely by editing markdown templates under `.jules-subagents/instructions`.
2. CI merge protocol can be tightened/relaxed in dashboard settings without code edits.
3. Loop behavior can be shaped for debugging or staged rollout by disabling selected steps.
4. Dot-directory migration is handled safely by default path resolution and legacy DB copy-forward.
