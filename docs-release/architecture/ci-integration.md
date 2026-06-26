# CI integration

The CI gate is the bridge between Code UX's task graph and your real GitHub-based CI. It decides when each subtask's PR can be merged and how to react when CI is unhappy.

## Source

`src/domain/sprint/ci/feature-pr-gate.ts` (`evaluateCiGate`, ~lines 30–290).

## Gate context

Each invocation receives a `CiGateContext`:

```ts
interface CiGateContext {
  automationLevel: AutomationLevel;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  gitStatus: GitTrackingStatus | null;
  ciAutofixRetryCounts: Map<string, number>;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId, message) => Promise<void>;
  autoMergeFeaturePr?: (args) => Promise<AutoMergeFeaturePrResult>;
  persistMergedTask: (task) => Promise<void>;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  openCiFixAttentionItems?: (items) => void;
  hasActiveWorkerCiFixAttempt?: (task, prNumber) => boolean;
  evaluateTaskQaGate?: (task) => TaskQaMergeGateStatus;
}
```

## Gate flow

For every subtask in `CODING_COMPLETED`, per cycle:

```
1. Apply pre-gate transitions (evaluatePreCiGateTransition)
   - COMPLETED + unmerged + has merge evidence → CODING_COMPLETED
   - CODING_COMPLETED + settled → COMPLETED

2. If CI disabled or no completed-awaiting-merge tasks → return early.

3. Find matching PR in gitStatus (by worker branch).

4. Branch on PR state:
   ├── Already merged
   │     → status COMPLETED
   │     → is_merged: true
   │     → merge_indicator: MERGED or AUTOMERGE
   │     → persistMergedTask(task)
   │
   ├── No PR found
   │     → status RUNNING (worker hasn't pushed yet)
   │     → merge_indicator: CI
   │
   ├── Merge conflict (DIRTY or rebase failure)
   │     → status CODING_COMPLETED
   │     → merge_indicator: MERGE_CONFLICT
   │     → If resolveMergeConflicts: dispatch merge_conflict worker
   │     → Else: openCiFixAttentionItems
   │
   ├── CI failing
   │     → If waitForJulesCiAutofix and retries < julesCiAutofixMaxRetries:
   │           dispatch ci_fix worker, increment counter
   │     → Else:
   │           openCiFixAttentionItems
   │
   └── CI green
         → Check comment-resolution gate
         │   (resolveAllCommentsBeforeFeatureMerge → unresolved comments block)
         → Check QA gate (if evaluateTaskQaGate provided)
         │   (returns BLOCKED|PASSED|PENDING)
         → Apply featurePrAutoMergeMode:
             ├── OFF      → no action; merge manually
             ├── CREATE_PR → keep PR open, mark PR_ONLY
             ├── WHEN_GREEN → autoMergeFeaturePr(prNumber)
             └── ALWAYS    → autoMergeFeaturePr(prNumber)
```

## Merge indicators

The `merge_indicator` field on a task documents the latest gate decision:

| Value | Meaning |
| --- | --- |
| `CI` | Awaiting worker push or CI run. |
| `AUTOMERGE` | Merged by an auto-merge policy. |
| `MERGED` | Merged manually or via PR_ONLY policy. |
| `MERGE_BLOCKED` | Merge attempt rejected (e.g. failing required check). |
| `MERGE_CONFLICT` | Git conflict on rebase. |
| `PR_ONLY` | PR is open; policy chose not to auto-merge. |
| `QA_PENDING` | QA review pending. |

## GitHub modes

### `REMOTE`

- Uses `gh` CLI / GitHub REST API.
- Reads PR status, CI checks, inline comments.
- Required for `WHEN_GREEN`, `ALWAYS`, comment-resolution gate, QA gate live signals.
- Requires `gh auth status` to succeed (or `GITHUB_TOKEN`).

### `LOCAL`

- Operates only on local Git state.
- PR-related features degrade: no live CI, no auto-merge of remote PRs, no comment gating.
- Useful for offline environments or single-author workflows.

## Auto-merge modes

`featurePrAutoMergeMode` and `mainBranchAutoMergeMode`:

| Mode | Behaviour |
| --- | --- |
| `OFF` | Manual only. Engine surfaces the merge command. |
| `CREATE_PR` | Open the PR and stop. |
| `WHEN_GREEN` | Open + wait for green + comment resolution + QA pass + merge. |
| `ALWAYS` | Merge regardless. *Use carefully.* |

Defaults: both `OFF`. Opt in deliberately.

## CI autofix worker

When `waitForJulesCiAutofix: true` and a PR has failing CI:

1. Engine consults `ciAutofixRetryCounts.get(taskId)`.
2. If `< julesCiAutofixMaxRetries`:
   - Dispatch a virtual worker on the `ci_fix` invocation routing.
   - Pass the failing CI log as context.
   - Increment the counter.
3. If `>=` cap:
   - Open an attention item with the failing CI summary.

Default retry cap: `3`, max `20`.

## Merge-conflict worker

When `resolveMergeConflicts: true` and a PR has a conflict:

1. Dispatch a virtual worker on the `merge_conflict` invocation routing.
2. Pass the conflict file list and the conflict markers.
3. Worker resolves, pushes, and the next cycle re-runs the gate.

If `resolveMergeConflicts: false`, an attention item is opened immediately.

## Comment-resolution gate

`resolveAllCommentsBeforeFeatureMerge` (default `true`) blocks auto-merge until every PR comment with state `OPEN` is resolved. Same for `resolveAllCommentsBeforeMainMerge` on the main-branch step.

The gate inspects comments via `gh api` in REMOTE mode. In LOCAL mode this gate degrades to "no comments visible" and is effectively a no-op.

## QA gate

If a project wires `qa_review` in routing and provides an `evaluateTaskQaGate` implementation:

- Returns `BLOCKED` / `PASSED` / `PENDING`.
- `BLOCKED` → task transitions to `QA_REVIEW_FAILED`, attention item opened.
- `PENDING` → merge held, status remains `CODING_COMPLETED` with `QA_PENDING`.
- `PASSED` → merge proceeds.

## Main-branch merge

The same gate logic runs at sprint finalisation, this time targeting the merge of the feature branch into `defaultBranch`. Settings in play:

- `mainBranchAutoMergeMode`
- `resolveMainMergeConflicts`
- `resolveAllCommentsBeforeMainMerge`

## Live PR monitoring

`enableLivePrMonitoring: true` (default) makes the watch loop poll PR status every cycle even when no immediate action is needed, so the dashboard's Git CI status panel stays current.

## Telemetry

Per gate evaluation, the engine records:

- Decision made (advance / block / merge).
- PR number, CI status snapshot.
- Reason (e.g. `MERGE_CONFLICT`, `WAITING_FOR_CI`, `AUTOMERGED`).

Visible via `/api/projects/:id/execution/invocations?type=ci_gate` and the live timeline.
