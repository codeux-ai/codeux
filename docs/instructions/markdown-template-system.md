# Markdown Template System

The sprint loop uses editable markdown templates for all major operator-facing instructions.

## Why This Exists

- Make orchestration messaging editable without TypeScript edits.
- Keep operational language human-readable and policy-driven.
- Allow project/team overrides while preserving safe defaults.

## Template Service Components

- `src/instructions/instruction-template-renderer.ts`
  - Replaces placeholders like `{{key}}`.
  - Supports nested keys like `{{group.subkey}}`.
- `src/instructions/instruction-template-repository.ts`
  - Resolves templates from override paths.
- `src/instructions/instruction-template-catalog.ts`
  - Maps template IDs to relative paths and fallback defaults.
- `src/instructions/instruction-template-service.ts`
  - Loads override template or fallback, then renders placeholders.

## Search Paths

Template lookup order is built from available context and deduplicated:

1. `repo_path/.jules-subagents/instructions/...` (if repo path is provided)
2. `cwd/.jules-subagents/instructions/...`
3. `projectRoot/.jules-subagents/instructions/...`
4. `home/.jules-subagents/instructions/...`

Compatibility fallback is also checked for each root:
- `.jules-subagents/intructions/...`

## Current Template Structure

```text
.jules-subagents/instructions/sprint-main-loop/
├─ guards/
├─ planning/
├─ protocol/
├─ watch/
└─ cleanup/
```

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
- `watchContinue`
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
- `src/instructions/instruction-template-renderer.test.ts`
- `src/instructions/instruction-template-service.test.ts`
