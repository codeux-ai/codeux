# Automation, CI and merge policy

Code UX integrates with your existing GitHub-based CI to gate merges, automatically retry CI fixes, and surface the rest as attention items. This page describes those policies and how to tune them.

## Automation level

The **master switch** is `automationLevel` (Settings → Automation):

| Level | Behaviour |
| --- | --- |
| `FULL` | Auto-handle everything possible: plan approvals, clarifications, paused sessions, attention items eligible for virtual workers. |
| `SEMI_AUTO` *(default)* | Respect each individual toggle in `automationInterventions`. Sensible mix. |
| `ALWAYS_ASK` | Never auto-act; everything escalates to a human attention item. Use for sensitive sprints. |

## Action-required automation

The `automationInterventions` block (Settings → Automation) governs auto-handling of session states. Defaults:

| Toggle | Default | Description |
| --- | --- | --- |
| `autoApprovePlan` | `true` | Auto-approve sessions in `AWAITING_PLAN_APPROVAL`. |
| `autoAnswerClarification` | `false` | Auto-respond to `AWAITING_USER_FEEDBACK`. |
| `autoAnswerClarificationMode` | `TEMPLATE` | `TEMPLATE` uses a literal template; `WORKER` dispatches a worker. |
| `autoResumePaused` | `false` | Auto-resume `PAUSED` sessions. |
| `clarificationAnswerTemplate` | *(prompt to "Proceed with the safest implementation path…")* | Default reply when `TEMPLATE` mode is active. |
| `clarificationCooldownSeconds` | `300` | Within this window, identical prompts are not re-answered (dedup). |

Each is independently overridable at project and sprint scope.

## CI intelligence

The `ciIntelligence` block (Settings → CI & Merge) controls how Code UX interacts with PRs and CI.

### Master toggles

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the whole CI gate. |
| `enableLivePrMonitoring` | `true` | Poll PR status during the watch loop. |

### Comment & conflict gating

| Field | Default | Notes |
| --- | --- | --- |
| `resolveAllCommentsBeforeFeatureMerge` | `true` | Block feature-PR merge until inline comments are resolved. |
| `resolveAllCommentsBeforeMainMerge` | `true` | Same gate for the main-branch merge step. |
| `resolveMergeConflicts` | `true` | If true, dispatch a `merge_conflict` worker on conflict. |
| `resolveMainMergeConflicts` | `true` | Same for the main-branch merge. |

### CI autofix

| Field | Default | Notes |
| --- | --- | --- |
| `waitForJulesCiAutofix` | `false` | If true, dispatch a `VirtualWorkerService` doing `ci_fix` tasks on failing CI. |
| `julesCiAutofixMaxRetries` | `5` (max `20`) | Legacy mirror of the CI-fix guardrail; max attempts before human handoff. |

### Auto-merge modes

Two mode fields control auto-merge:

| Field | Modes |
| --- | --- |
| `featurePrAutoMergeMode` | `OFF`, `CREATE_PR`, `WHEN_GREEN`, `ALWAYS` |
| `mainBranchAutoMergeMode` | `OFF`, `CREATE_PR`, `WHEN_GREEN`, `ALWAYS` |

| Mode | Behaviour |
| --- | --- |
| `OFF` | Manual merge only. Code UX shows the command. |
| `CREATE_PR` | Open the PR and stop. |
| `WHEN_GREEN` | Open the PR, watch CI, merge when all checks pass and gates are satisfied. |
| `ALWAYS` | Merge regardless of CI status. *Use with caution.* |

Defaults: `featurePrAutoMergeMode = ALWAYS`, `mainBranchAutoMergeMode = CREATE_PR`.

## How the merge protocol decides

Per cycle, for every task in `CODING_COMPLETED`:

1. **Find the PR** matching the task's worker branch via `git status` and the GitHub API (in `REMOTE` mode) or local Git (in `LOCAL` mode).
2. **If already merged** → mark `COMPLETED`, set `is_merged: true`, `merge_indicator = MERGED` or `AUTOMERGE`.
3. **If no PR found** → revert to `RUNNING`, set `merge_indicator = CI` (waiting for the worker to push).
4. **If PR has merge conflict** → set `merge_indicator = MERGE_CONFLICT`. If `resolveMergeConflicts: true`, dispatch a worker; else create an attention item.
5. **If CI failing** → if `waitForJulesCiAutofix: true` and retry budget remains, dispatch a `VirtualWorkerService` doing `ci_fix` tasks; else create an attention item.
6. **If CI green** → check comment-resolution gate; if pass, run `featurePrAutoMergeMode` policy.

The same flow drives the *main branch* merge during finalisation, using `mainBranchAutoMergeMode` and the `resolveMainMergeConflicts` / `resolveAllCommentsBeforeMainMerge` toggles.

## GitHub mode

Per project (Settings → Git):

- **`REMOTE`** *(default)* — uses `gh` CLI / GitHub REST API. Reads PR status, comments, CI checks. Required for `WHEN_GREEN` and comment-resolution gates.
- **`LOCAL`** — operates only on local Git state. PR-related features degrade gracefully (no live CI, manual merge prompts only).

`REMOTE` requires `gh auth status` to succeed (or `GITHUB_TOKEN` set).

## CI smoke coverage

The Playwright `navigation` project smoke-tests the dashboard Docs page. It covers `/docs`, the docs overview, dashboard overview, and representative sample pages so CI catches broken packaged docs routes before release.

## Merge indicators

The `merge_indicator` field on a subtask documents the merge state:

| Value | Meaning |
| --- | --- |
| `CI` | Waiting for worker to push PR or CI to settle. |
| `AUTOMERGE` | Merged by the auto-merge policy. |
| `MERGED` | Merged manually (or via PR_ONLY policy). |
| `MERGE_BLOCKED` | Merge attempt rejected by the gate. |
| `MERGE_CONFLICT` | Git conflict on rebase. |
| `PR_ONLY` | PR is open, but the policy chose not to merge into the feature branch. |
| `QA_PENDING` | A QA review is pending. |

## QA gate (enabled by default)

If a QA agent preset is wired to `qa_review` in routing, completed tasks pass through a QA review *before* the merge protocol greenlights them. A non-passing review that exhausts its configured guardrail:

- Sets task status to `QA_REVIEW_FAILED`.
- Creates an attention item with the QA agent's findings.
- Pauses the task until rectified.

Provider or infrastructure errors do not immediately create this handoff. Recovered failed, cancelled, and errored attempts retry within a bounded infrastructure grace, and every terminal attempt counts toward the hard ceiling. A CLI QA fix that produces no new patch is escalated as no progress instead of starting another QA cycle; existing branch commits do not renew the cycle. A coding run that produces no changes must explicitly confirm completion or it is blocked for attention. The sprint watch loop stays alive while worker or human attention is active.

QA review has its own durable session, separate from the coding session that receives fixes. With the restart invocation policy set to `continue`, Code UX resumes an interrupted reviewer in the same isolated review workspace and continues the provider conversation when the provider supports native session resumption. That workspace is reused only to finish the same partial review cycle; after a decisive verdict, the next verification starts from a fresh branch snapshot so it includes any coding follow-up. A requested-fix verdict is saved before its coding handoff starts. If restart lands in that gap, the next watch cycle resumes the pending handoff; if the coding follow-up already completed, Code UX advances to verification without repeating it. An abruptly failed coding handoff returns to the saved QA checkpoint and retries the same coding session/workspace up to the bounded continuation limit before applying the configured QA exhaustion policy.

Task and sprint summary badges select one reviewer from the newest QA cycle. Within that cycle, running reviews appear first, followed by requested changes, provider failures (`failed`, `cancelled`, or `errored`), passes, and other states. This keeps a passing reviewer from hiding another reviewer that is still active, has blocked the work, or did not return a usable verdict.

## Attention items: who handles them

Anything not auto-handled becomes an attention item. The dashboard's **Live Session** page surfaces them.

If `workers.virtualWorkerProvider` is set and the item type is eligible (`merge_conflict`, `ci_failure`, `action_required`), the [virtual worker service](../architecture/virtual-workers.md) will offer it to a virtual worker before showing it to a human.

The eligible attention items per provider:

- All providers can handle `merge_conflict` and `ci_failure` if their CLI supports applying patches.
- Plan approval and clarification reply are handled by the configured automation, not virtual workers.

Humans can claim and resolve items at any time from the dashboard.

Under the restart `continue` policy, an interrupted Code UX-owned CI-fix or merge-conflict item is released from the stopped virtual worker and returned to the worker queue. Its replacement invocation reuses the prior logical session and repair workspace, and resumes the provider-native conversation when available. This preserves partial edits and provider reasoning across a normal runtime restart instead of spending a new guardrail attempt on the same interrupted work.

## Recommended settings recipes

### Conservative (recommended starting point)
```jsonc
{
  "automationLevel": "SEMI_AUTO",
  "automationInterventions": { "autoApprovePlan": true, "autoAnswerClarification": false },
  "ciIntelligence": {
    "featurePrAutoMergeMode": "WHEN_GREEN",
    "mainBranchAutoMergeMode": "OFF",
    "waitForJulesCiAutofix": true,
    "julesCiAutofixMaxRetries": 5
  }
}
```

### Hands-off
```jsonc
{
  "automationLevel": "FULL",
  "automationInterventions": { "autoAnswerClarification": true, "autoAnswerClarificationMode": "WORKER", "autoResumePaused": true },
  "ciIntelligence": {
    "featurePrAutoMergeMode": "WHEN_GREEN",
    "mainBranchAutoMergeMode": "WHEN_GREEN",
    "resolveMergeConflicts": true,
    "waitForJulesCiAutofix": true
  }
}
```

### Audit mode
```jsonc
{
  "automationLevel": "ALWAYS_ASK",
  "ciIntelligence": {
    "featurePrAutoMergeMode": "CREATE_PR",
    "mainBranchAutoMergeMode": "OFF"
  }
}
```
