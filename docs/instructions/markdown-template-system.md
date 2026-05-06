# Markdown Template System

The sprint engine uses editable markdown templates for operator-facing status, merge, attention, and cleanup instructions.

## Why This Exists

- Make orchestration messaging editable without TypeScript edits.
- Keep protocol text in the database-backed settings model instead of loose markdown files.
- Allow system defaults plus per-project overrides while preserving built-in fallbacks.

## Template Service Components

- `src/instructions/instruction-template-renderer.ts`
  - Replaces placeholders like `{{key}}`.
  - Supports nested keys like `{{group.subkey}}`.
- `src/instructions/instruction-template-catalog.ts`
  - Defines template IDs and built-in default markdown.
- `src/instructions/instruction-template-service.ts`
  - Resolves the effective template from scoped settings, then renders placeholders.
- `src/repositories/settings-repository.ts`
  - Stores the system and project copies of `agents.instructionTemplates`.
- `dashboard/src/v2/SettingsPage.tsx`
  - Provides the editor under `Settings -> Agents`.

## Storage Model

Templates are stored in the `agents.instructionTemplates` settings section:

1. built-in defaults come from `src/instructions/instruction-template-catalog.ts`
2. system scope can override any template in sqlite
3. project scope can override any template for a selected project
4. runtime resolution uses the project override when `repoPath` maps to a known project
5. no file lookup under `.code-ux/instructions` or `.jules-subagents/instructions` remains

## Template IDs in Catalog

Examples:
- `branchMissing`
- `planningMissing`
- `planningCreated`
- `mergeHeader`
- `mergeTask`
- `actionRequiredAgentHeader`
- `actionRequiredAgentTask`
- `actionRequiredHumanHeader`
- `actionRequiredHumanTask`
- `watchHeader`
- `watchMergeRequired`
- `watchNoMoreActions`
- `completionSteps`
- `cleanupAllMerged`
- `cleanupFailed`
- `cleanupDeferred`
- `cleanupEmpty`

## Placeholder Rules

### Supported syntax
- `{{key}}`
- `{{nested.key}}`

### Missing key behavior
- Missing values render as empty string.

### Array behavior
- Arrays are joined by newline when rendered.

## Editing Best Practices

1. Keep markdown structure stable for readability in dashboard and MCP output.
2. Do not remove placeholders expected by the code path unless you also adjust orchestration logic.
3. Keep instruction text imperative and explicit.
4. Include command examples in fenced code blocks where action is required.
5. Use system scope for shared defaults and project scope only when a repository truly needs custom operator guidance.

## Example

Template:

```md
### Merge Task
- Merge task `{{task_id}}` into `{{feature_branch}}`.
```

Variables:

```json
{
  "task_id": "03-api",
  "feature_branch": "feature/sprint12-implementation"
}
```

Rendered output:

```md
### Merge Task
- Merge task `03-api` into `feature/sprint12-implementation`.
```

## Testing

Template behavior tests:
- `tests/backend/instructions/instruction-template-renderer.test.ts`
- `tests/backend/instructions/instruction-template-service.test.ts`
