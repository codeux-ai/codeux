# Sprint Planning Guide

This guide defines the quality bar for Code UX planning.

The planner's job is to turn a sprint goal into a database-ready DAG of atomic tasks that coding agents can execute without guessing.

## Mission

- Plan as a DAG, not as a checklist.
- Maximize safe parallelism.
- Keep tasks atomic, technical, and testable.
- Remove ambiguity from executor prompts.
- Produce a complete plan in the Code UX JSON task format, not markdown task files.

## Research Standard

Before decomposing the sprint, the planner must infer as much concrete implementation context as possible:
- likely files to create, edit, or verify
- relevant modules, components, functions, classes, routes, tables, settings, or tests
- important data flow and side effects
- architectural boundaries that should define task ownership
- likely verification commands or test surfaces

The planner should never offload obvious discovery work to the executor when the target can be inferred during planning.

## Decomposition Rules

- Every task must own one coherent implementation slice.
- Each slice must have a clear output and a clear verification surface.
- Use dependencies only for true blockers.
- If two tasks can proceed in parallel, they must not depend on each other.
- Avoid giant umbrella tasks that span backend, frontend, tests, docs, and integration at once.
- Avoid placeholder tasks such as "analyze", "investigate", "review", "cleanup", or "coordinate".
- Do not create explicit branch, PR, merge, or release tasks. Code UX handles that.
- Prefer 3 to 8 tasks for normal sprint scope.

## Output Contract

Return JSON only with this shape:

```json
{
  "goal": "Optional refined sprint goal",
  "tasks": [
    {
      "key": "T01",
      "title": "Short imperative title",
      "description": "One-sentence outcome statement.",
      "promptMarkdown": "Full executor prompt",
      "priority": "medium",
      "executorType": "auto",
      "dependsOn": []
    }
  ]
}
```

Task formatting rules:
- `key` must use `T01`, `T02`, `T03`, ... in topological order.
- `title` must be concise and specific.
- `description` must explain the intended result in one sentence.
- `dependsOn` must reference only earlier task keys.
- `executorType` should default to `auto`.
- Return one ordered `tasks` array for the whole sprint.

## `promptMarkdown` Standard

Every task prompt must use the same structure and section order:

```md
## Objective
<short paragraph>

## Scope
- <exact files, modules, or symbols>

## Implementation Requirements
1. <concrete implementation step>
2. <concrete implementation step>
3. <concrete implementation step>

## Constraints
- <edge case or boundary>

## Verification
- <exact command, test, or runtime check>
- <success criteria>
```

Prompt quality rules:
- Make the prompt self-contained.
- Use exact file paths whenever they can be inferred.
- Name concrete symbols and data boundaries whenever possible.
- Tell the executor what to implement, what to preserve, and how to verify.
- Do not ask the executor to invent the plan.
- Do not include markdown frontmatter or separate task-file instructions.

## Multi-Task Formatting Rules

When multiple tasks are needed:
- order the array topologically
- place independent roots first
- place fan-in integration tasks after their prerequisites
- avoid overlapping ownership across sibling tasks
- keep the final array readable as a DAG from top to bottom

Bad:
- task array sorted by theme but not by dependency order
- frontend task depending on backend task when both could be parallel
- giant final "finish sprint" task with vague acceptance

Good:
- root tasks for independent backend and frontend slices
- one follow-up integration task only when truly needed
- one test-hardening task only when verification cannot live naturally inside the implementation slice

## Example A

```json
{
  "goal": "Add runtime-aware project override badges and keep inherited settings unbadged.",
  "tasks": [
    {
      "key": "T01",
      "title": "Add override metadata helper",
      "description": "Create a shared helper that resolves whether each settings field is overridden at project scope.",
      "promptMarkdown": "## Objective\nAdd a shared helper that converts effective settings source metadata into per-field override display state for the project settings UI.\n\n## Scope\n- dashboard/src/v2/lib/settings-view-models.ts\n- tests/dashboard/lib/settings-view-models.test.ts\n\n## Implementation Requirements\n1. Add a helper that determines whether a field is overridden or inherited.\n2. Return no badge state for inherited values.\n3. Cover overridden and inherited cases with focused tests.\n\n## Constraints\n- Keep source resolution centralized.\n- Preserve existing effective settings contracts.\n\n## Verification\n- Run the focused settings view-model test file.\n- Confirm overridden fields resolve to override state and inherited fields resolve to no badge state.",
      "priority": "high",
      "executorType": "auto",
      "dependsOn": []
    },
    {
      "key": "T02",
      "title": "Render override badges in settings UI",
      "description": "Apply the shared override metadata to the project settings controls.",
      "promptMarkdown": "## Objective\nUse the shared override metadata helper to render the project override badge only on overridden settings controls.\n\n## Scope\n- dashboard/src/v2/SettingsPage.tsx\n- dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx\n\n## Implementation Requirements\n1. Read per-field override metadata from the shared helper.\n2. Show the badge only for overridden controls.\n3. Keep inherited controls free of placeholder badge UI.\n\n## Constraints\n- Reuse existing settings row patterns.\n- Keep layout stable when no badge is present.\n\n## Verification\n- Verify overridden controls show the badge and inherited controls do not.\n- Run relevant dashboard tests if present.",
      "priority": "medium",
      "executorType": "auto",
      "dependsOn": [
        "T01"
      ]
    }
  ]
}
```

## Example B

```json
{
  "goal": "Fix sprint finalization so no-output tasks do not block completion.",
  "tasks": [
    {
      "key": "T01",
      "title": "Centralize merge settlement rules",
      "description": "Create a shared helper that classifies whether a completed task still has merge work outstanding.",
      "promptMarkdown": "## Objective\nIntroduce one shared helper for deciding whether a completed task is coding-complete only or fully complete, including the no-output case.\n\n## Scope\n- src/domain/sprint/task-merge-state.ts\n- src/domain/sprint/ci/feature-pr-gate.ts\n- tests/backend/domain/sprint/ci/feature-pr-gate.test.ts\n\n## Implementation Requirements\n1. Add a reusable helper for merge settlement classification.\n2. Treat completed tasks with no PR URL and no worker branch as settled.\n3. Cover the no-output case with regression tests.\n\n## Constraints\n- Preserve existing behavior for PR-backed tasks.\n- Keep the helper side-effect free.\n\n## Verification\n- Run focused backend tests for feature PR gating.\n- Confirm no-output tasks are treated as settled while PR-backed tasks still wait for merge when required.",
      "priority": "high",
      "executorType": "auto",
      "dependsOn": []
    },
    {
      "key": "T02",
      "title": "Use merge settlement helper in sprint completion",
      "description": "Apply the shared settlement rules to watch-loop and status-derivation completion decisions.",
      "promptMarkdown": "## Objective\nUpdate sprint finalization so tasks without merge work advance cleanly to final completion and do not block sprint completion.\n\n## Scope\n- src/domain/sprint/orchestrator/watch-loop-runner.ts\n- src/sprint/steps/status-derivation-step.ts\n- src/sprint/steps/protocol-step.ts\n- tests/backend/sprint/watch-loop-core.test.ts\n\n## Implementation Requirements\n1. Replace duplicated merge-wait logic with the shared helper.\n2. Auto-complete tasks that have no merge work after coding is done.\n3. Add regression coverage for sprint completion with no-output tasks.\n\n## Constraints\n- Do not mark PR-backed tasks complete before merge conditions are satisfied.\n- Keep dependency unlock behavior consistent.\n\n## Verification\n- Run focused sprint runtime tests.\n- Confirm no-output tasks complete automatically and real merge-backed tasks still wait when required.",
      "priority": "high",
      "executorType": "auto",
      "dependsOn": [
        "T01"
      ]
    }
  ]
}
```

## Final Review Checklist

Before finishing the plan:
1. Is the task graph acyclic and topologically ordered?
2. Are dependencies minimal rather than habitual?
3. Does each task own a clean technical slice?
4. Does every `promptMarkdown` section contain concrete implementation detail?
5. Would a coding agent be able to execute each task without asking what format to use?
