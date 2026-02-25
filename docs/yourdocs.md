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

## Incremental Update: No-Key Runtime + CI Tracking Context

### No-Key Runtime Mode

- Startup no longer hard-fails when `JULES_API_KEY` is absent.
- Server logs actionable setup instructions with sources:
  - `.env`
  - `.jules-subagents/settings.json`
  - dashboard settings (`http://localhost:4444` default)
- API-backed MCP handlers now preflight key presence and return setup guidance text when missing.
- `sprint_agent` allows `plan` without key, but `status/orchestrate` return setup guidance until key exists.
- Saving dashboard settings now refreshes Jules API key in runtime (no restart required).
- Runtime key resolution now checks live environment variables (`JULES_API_KEY` / `JULES_KEY`) when dashboard key is empty.

Files:
- `src/index.ts`
- `src/jules-api.ts`
- `src/mcp/core-tool-handler.ts`
- `src/mcp/agent-tool-handler.ts`
- `src/sprint-orchestrator.ts`
- `src/api-key-guidance.ts`

### Context-Aware GitHub CI Tracking

Git tracking now follows sprint stage + CI gate settings:

1. `FEATURE_PR_CI`
- Active when tasks are running and feature-merge CI wait gate is enabled.
- Tracks open PRs targeting the feature branch and CI runs for those PR head branches.

2. `MAIN_MERGE_PR_CI`
- Active when sprint tasks are completed+merged and main-merge CI wait gate is enabled.
- Tracks the feature->main PR and CI runs for that PR head branch.

3. `MAIN_BRANCH_CI`
- Default in-between scope.
- Tracks main branch CI runs.

Recent merges:
- Includes all fetched merges into feature-prefixed branches and default branch.
- Dashboard now renders the full fetched merge list (no UI slice-to-5 truncation).

Files:
- `src/git-status-service.ts`
- `src/index.ts`
- `src/types.ts`
- `dashboard/src/types.ts`
- `dashboard/src/components/GitStatusPanel.tsx`

## Incremental Update: Interrupted CLI Session Recovery

Problem addressed:
- If MCP was interrupted while Gemini/Codex background tasks were running, tracked sessions could remain in `RUNNING` state.
- On the next orchestration cycle, session sync could bind tasks to those stale sessions, showing old logs and preventing fresh background starts.

Implementation:
1. Added startup recovery in server runtime:
- On boot, scan tracked sessions for local CLI sessions in `RUNNING` state.
- Mark those sessions `FAILED`.
- Append a system activity explaining interrupted-process recovery.

2. Recovery scope:
- Applies only to tracked local CLI sessions:
  - session id prefix `cli-*`
  - providers `gemini` or `codex`
- Jules API sessions are not modified.

3. Orchestration effect:
- Session sync now sees recovered sessions as `FAILED`.
- With retry enabled (default), subtasks move back to `PENDING` and can start new background sessions.

Files:
- `src/session-tracking-repository.ts`
- `src/index.ts`
- `src/session-tracking-repository.test.ts`
- `docs/operations/runbook.md`

## Incremental Update: Background CLI `--yolo` Mode

Change:
- Added `--yolo` for both background provider runners to reduce approval/tool-gating friction during autonomous execution.

Provider command behavior:
- Gemini background run now uses: `gemini --yolo "<prompt>"`
- Codex background run now uses: `codex exec --full-auto --yolo --output-last-message "<prompt>"`

File:
- `src/cli-workflow-service.ts`

## Incremental Update: Detect Provider Commits With Clean Worktree

Problem:
- Background provider could commit/push directly.
- MCP previously checked only `git status --porcelain`; if clean, it incorrectly reported “No file changes produced.”

Fix:
- Capture `HEAD` before provider run and compare with `HEAD` after run.
- Treat `HEAD` movement as produced output, even when working tree is clean.
- If provider changed branches during execution, switch back to the expected worker branch before finalize/push.

File:
- `src/cli-workflow-service.ts`

## Incremental Update: Configurable Failed-Worktree Retention + Read-File Retry

Problem:
- Failed CLI sessions could discard worktree state automatically, wasting progress.
- Some Gemini/Codex runs failed early on `Error executing tool read_file: File not found`.

Changes:
1. Added CLI workflow settings (dashboard + backend persistence):
- `cliWorkflow.cleanupWorktreeOnSuccess` (default: `true`)
- `cliWorkflow.cleanupWorktreeOnFailure` (default: `false`)
- `cliWorkflow.retryOnReadFileNotFound` (default: `true`)

2. Runtime behavior:
- Worktree cleanup now depends on success/failure + CLI workflow settings.
- Default behavior preserves failed worktrees for recovery/follow-up.
- On failure retention, activity log includes preserved workspace path and branch.

3. Retry behavior for file-not-found reads:
- If provider exits with `Error executing tool read_file: File not found`, workflow retries once with explicit file-discovery guidance appended to the prompt.
- If retry still fails, session remains `FAILED` and preserved worktree policy is applied.

Files:
- `src/types.ts`
- `dashboard/src/types.ts`
- `src/settings-repository.ts`
- `src/settings-repository.test.ts`
- `dashboard/src/lib/settings.ts`
- `dashboard/src/lib/settings.test.ts`
- `dashboard/src/components/SettingsPage.tsx`
- `src/cli-workflow-service.ts`
- `docs/operations/runbook.md`

## Incremental Update: Provider STDERR Labeling + Prompt De-duplication

Problem:
- Provider tool/runtime lines were shown as `system`, making MCP errors and provider stderr hard to distinguish.
- CLI providers were receiving duplicated `worker.md` instruction blocks (one injected in task service, one in CLI workflow service), increasing prompt noise and instability risk.

Changes:
1. Activity origin clarity:
- Background provider stderr is now stored with `originator: "provider"` and prefixed with provider label (e.g. `[gemini] ...`).
- Dashboard task feed now renders `provider` origin with distinct styling.

2. Prompt de-duplication:
- `TaskService` now sends raw task prompt to Gemini/Codex workflow.
- `CliWorkflowService` remains the single place that injects `worker.md` for background CLI runs.
- Jules API sessions keep existing prompt-building flow.

Files:
- `src/cli-workflow-service.ts`
- `dashboard/src/components/TaskCard.tsx`
- `src/task-service.ts`

## Incremental Update: Headless Path-Safety Guardrails

Problem:
- Headless provider runs can fail early on wrong file path assumptions (`read_file` not found), especially without interactive correction.

Changes:
- Added a workspace context block to every Gemini/Codex background prompt after worktree creation:
  - explicit repository root
  - explicit current working directory
  - required path-discovery steps before `read_file`
  - detected file-path hints from task prompt with existence pre-check (`exists` / `not-found`)
- This guidance is injected directly in `CliWorkflowService`, so all headless runs share the same path discipline.

Files:
- `src/cli-workflow-service.ts`

## Incremental Update: Worktree Location Relocation

Change:
- Background provider worktrees are now created under home-scoped runtime storage instead of inside the target repository.
- New location pattern:
  - `~/.jules-subagents/worktrees/<repo-name>-<repo-hash>/<session-id>`

Rationale:
- Prevents repository pollution when `.jules-subagents/worktrees` is not ignored.
- Keeps transient execution workspaces in one runtime-managed location.

File:
- `src/cli-workflow-service.ts`

## Incremental Update: Retry In Same Failed Workspace

Change:
- Added CLI workflow toggle:
  - `cliWorkflow.resumeFailedTaskInSameWorkspace` (default: `true`)

Behavior:
- On retry, workflow looks up the latest failed CLI session for the same:
  - provider
  - task id
  - feature branch
  - repo path
- If the failed workspace is still valid, the new retry run resumes in that same worktree and branch.
- If resume target is unavailable/corrupted, workflow falls back to a fresh worktree.
- Legacy compatibility: if a failed session used the old repo-local worktree path, resume checks that legacy path and can still continue from it.

Related files:
- `src/session-tracking-repository.ts`
- `src/session-tracking-repository.test.ts`
- `src/cli-workflow-service.ts`
- `src/settings-repository.ts`
- `dashboard/src/lib/settings.ts`
- `dashboard/src/components/SettingsPage.tsx`

## Incremental Update: Multi-Provider Task Workflow Parity

### Goal

Bring Gemini CLI and Codex CLI task execution to the same operational pattern used by Jules:
- task-level branch workflow
- PR back into sprint feature branch
- session/status visibility in dashboard
- live activity feed

### Provider Routing and Settings

Added provider strategy and per-provider runtime settings:
- Providers: `jules`, `gemini`, `codex`
- Strategies:
  - `MANUAL`
  - `WEIGHTED`
  - `ORCHESTRATOR`
- Per-provider controls:
  - `enabled`
  - `model`
  - `weight`
  - `thinkingMode` (`SMALL|MEDIUM|HIGH`)
  - `apiKey` (optional)

Files:
- `src/types.ts`
- `dashboard/src/types.ts`
- `src/settings-repository.ts`
- `dashboard/src/lib/settings.ts`
- `dashboard/src/components/SettingsPage.tsx`
- `src/provider-routing.ts`

### Background CLI Workflow

Added `CliWorkflowService` for Gemini/Codex:
1. Create task child branch from sprint feature branch.
2. Run CLI command in background.
3. Capture stdout/stderr as session activities.
4. Commit/push changes.
5. Create PR back to sprint feature branch.
6. Update session state (`RUNNING` -> `COMPLETED|FAILED`).

Files:
- `src/cli-workflow-service.ts`
- `src/task-service.ts`

### SQLite Session Tracking for CLI Providers

Added provider session/activity persistence:
- DB: `~/.jules-subagents/session-tracking.db`
- Tables:
  - `provider_sessions`
  - `provider_activities`

This storage backs:
- session sync
- MCP session/activity tool compatibility for tracked CLI sessions
- dashboard live feed rendering

Files:
- `src/session-tracking-repository.ts`
- `src/index.ts`
- `src/mcp/core-tool-handler.ts`

### Sprint Loop Integration

- Start-ready step now starts provider-specific sessions.
- Session sync merges Jules API sessions and tracked CLI sessions.
- Status/protocol text carries provider context.
- Merge/action-required instruction templates updated to provider-agnostic wording.

Files:
- `src/sprint-orchestrator.ts`
- `src/sprint/steps/start-ready-tasks-step.ts`
- `src/sprint/steps/session-sync-step.ts`
- `src/sprint/steps/protocol-step.ts`
- `src/sprint/steps/status-table-step.ts`
- `src/instructions/catalog.ts`
- `.jules-subagents/instructions/sprint-main-loop/protocol/*.md`
