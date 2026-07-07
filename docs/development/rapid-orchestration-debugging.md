# Rapid Orchestration Debugging Suite

This suite is the escalation ladder for sprint orchestration failures. Use it when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix.

The suite is intentionally split into fast deterministic lanes and slower compiled-runtime lanes. Start with the smallest lane that can reproduce the issue, then broaden only after it passes.

## Lane Summary

| Lane | Command | Purpose | Expected runtime |
| --- | --- | --- | --- |
| Fast regressions | `pnpm run test:orchestration:rapid` | Watch-loop, feature merge, and local final-merge regressions without Docker or provider CLIs. | Seconds to a few minutes |
| Mockup merge E2E | `pnpm run test:orchestration:merge-e2e` | Compiled runtime plus `mockup-cli` through a deterministic local merge-conflict DAG. | Up to 15 minutes |
| Completion conflict E2E | `pnpm run test:orchestration:completion-conflict` | Compiled runtime final LOCAL merge conflict repair after default-branch mutation during orchestration. | Up to 20 minutes |
| Full mockup pentest | `pnpm run test:orchestration:full` | All deterministic mockup scenarios: smoke, CI repair, merge conflict, parallel DAG, multi-project overrides. | Longer-running |
| Large DAG stress | `pnpm run test:orchestration:large-dag` | Heavy 129-task mockup DAG with wide fan-out and layered joins. | Long-running |
| Full heavy pentest | `pnpm run test:orchestration:pentest` | Default mockup catalog plus heavy stress scenarios. | Long-running |
| Backend broadening | `pnpm run test:backend` | Full backend suite after focused fixes. | Medium |
| Release validation | `pnpm run lint && pnpm run build` | Type safety and compiled server/dashboard output. | Medium |

## Fast Regression Lane

Run:

```bash
pnpm run test:orchestration:rapid
```

This lane executes:

- `tests/backend/services/virtual-worker-service.test.ts`
- `tests/backend/infrastructure/providers/cli/provider-runner.test.ts`
- `tests/backend/services/provider-routing.test.ts`
- `tests/backend/sprint/watch-loop-core.test.ts`
- `tests/backend/domain/sprint/ci/feature-pr-gate.test.ts`
- `tests/backend/infrastructure/git/local-merge.test.ts`

Use this lane first for:

- LOCAL runs stuck at remote-style `ready_for_merge` feedback.
- LOCAL final merge conflicts or temporary-worktree failures.
- Dirty visible checkouts that must be preserved before final merge.
- Worker-owned merge-conflict attention items being opened, resolved, or retried incorrectly.
- Mockup virtual-worker routes falling back to credentialed providers.
- Mockup virtual merge-conflict workers completing without removing active conflict markers.
- Virtual conflict repair falling back when container Git cannot list unresolved files with `git diff`.
- Task dependency unlocks after worker branch merges into the sprint feature branch.

The lane must stay credential-free and isolated. It should mock provider, GitHub, Docker, and external network boundaries unless a test specifically targets host Git behavior.

## Mockup Merge E2E Lane

Run:

```bash
pnpm run test:orchestration:merge-e2e
```

This builds the compiled runtime and runs:

```bash
node scripts/e2e/run-mockup-sprint-pentest.mjs --scenario merge-conflict-dag --timeout-ms 900000
```

Use it after a unit-level merge fix passes. It validates that the compiled server, SQLite state, project settings, Docker-backed CLI workflow, `mockup-cli`, DAG execution, merge-conflict handling, and final repository assertions work together.

The scenario asserts that:

- sibling DAG tasks create deterministic conflicting edits;
- the join task resolves the final content;
- task statuses reach `completed`;
- the merged repository contains the resolved content;
- conflict markers such as `<<<<<<<` and `>>>>>>>` are absent;
- validation command `node test/run-validation.mjs` exits successfully.

Artifacts are written under:

```text
.cache/e2e-mockup-sprint-pentest/<run-id>/
```

Inspect `server.log`, top-level `summary.json`, the scenario `summary.json`, and per-project `task-statuses.json` when this lane fails.

## Completion Conflict E2E Lane

Run:

```bash
pnpm run test:orchestration:completion-conflict
```

This builds the compiled runtime and runs:

```bash
node scripts/e2e/run-mockup-sprint-pentest.mjs --scenario completion-merge-conflict --timeout-ms 1200000
```

Use it when final sprint completion is suspect. The scenario waits for the orchestrator to leave the default branch, mutates the default branch through a detached worktree, then validates that the final LOCAL sprint merge opens worker-owned conflict repair and completes with resolved content on the default branch.

## Full Mockup Pentest Lane

Run:

```bash
pnpm run test:orchestration:full
```

This builds the runtime and runs every `mockup-cli` scenario through `scripts/e2e/run-mockup-sprint-pentest.mjs`.

Run this lane before calling a merge/orchestration incident fixed. It covers:

- `smoke-completion`: dependency-chain completion and final local repository assertions.
- `ci-repair`: deterministic failing validation repaired by a worker.
- `merge-conflict-dag`: sibling edit conflict plus resolved join output.
- `parallel-independent`: fan-out/fan-in scheduling.
- `dirty-checkout-final-merge`: LOCAL final merge while the visible checkout contains uncommitted non-conflicting work.
- `completion-merge-conflict`: default-branch mutation during orchestration so sprint-completion final merge conflict repair is exercised.
- `multi-project-overrides`: separate local projects with different settings overrides.

## Large DAG Stress Lane

Run:

```bash
pnpm run test:orchestration:large-dag
```

This builds the runtime and executes `large-dag-stress`, a deterministic 129-task sprint:

- 1 root setup task.
- 96 leaf module tasks.
- 24 batch aggregation tasks.
- 6 group aggregation tasks.
- 1 final manifest task.
- 1 validation task.

Use this lane for scheduler pressure, dependency unlocks, provider concurrency, watch-loop heartbeat stability, SQLite write pressure, Docker workspace cleanup, and final local merge behavior under a large graph.

During a healthy run, the active task-run count should stay near the fixture provider cap. For example, `wide-docker` uses `mockup-cli` with `maxConcurrentTasks: 5`, so the live database should show about five `task_runs.state = 'RUNNING'` while the remaining unlocked work stays `pending`.

Check this while the run is active:

```bash
latest=$(ls -td .cache/e2e-mockup-sprint-pentest/* | head -1)
node - "$latest/home/.code-ux/app.db" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2], { readonly: true });
console.log(db.prepare("SELECT status, count(*) count FROM tasks GROUP BY status ORDER BY status").all());
console.log(db.prepare("SELECT state, count(*) count FROM task_runs GROUP BY state ORDER BY state").all());
console.log(db.prepare("SELECT provider, count(*) count FROM task_runs WHERE state = 'RUNNING' GROUP BY provider").all());
console.log(db.prepare("SELECT status, count(*) count FROM provider_invocations GROUP BY status ORDER BY status").all());
NODE
```

If task runs grow far beyond the provider cap while provider invocations remain low, the scheduler is admitting CLI sessions faster than the provider runtime can execute them. The provider concurrency count must include running task runs as well as running provider invocations, because Docker CLI sessions reserve orchestration capacity before their provider invocation row starts.

Run the full heavy catalog with:

```bash
pnpm run test:orchestration:pentest
```

## Local Merge Incident Checklist

Use this checklist while monitoring an approved local test project.

1. Confirm the runtime is healthy:

```bash
curl -fsS http://127.0.0.1:4444/ready
```

2. Inspect run lifecycle state in the local SQLite database:

```bash
node - <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(`${process.env.HOME}/.code-ux/app.db`, { readonly: true });
console.log(db.prepare(`
  SELECT sr.id, s.number, sr.status, sr.last_heartbeat_at, sr.finished_at
  FROM sprint_runs sr
  JOIN sprints s ON s.id = sr.sprint_id
  ORDER BY sr.updated_at DESC
  LIMIT 12
`).all());
NODE
```

3. Inspect unresolved attention before assuming the run is idle:

```bash
node - <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(`${process.env.HOME}/.code-ux/app.db`, { readonly: true });
console.log(db.prepare(`
  SELECT id, attention_type, owner_type, status, opened_at, resolved_at
  FROM project_attention_items
  WHERE status IN ('open', 'claimed')
  ORDER BY opened_at DESC
  LIMIT 20
`).all());
NODE
```

4. Inspect the local repository without mutating it:

```bash
git -C <approved-local-test-repo> status --short --branch
git -C <approved-local-test-repo> log --oneline --decorate -12 --all
```

5. If the visible checkout is dirty, keep it dirty during one validation pass. LOCAL finalization must preserve it on a `dirty-ref-<uuid>` branch before the sprint feature branch is merged into the default branch.

6. If a main-merge conflict item is worker-owned, the watch loop must not clear it from remote PR feedback in LOCAL mode. It should retry final merge only after the worker resolves the source branch and the next temporary-worktree merge succeeds.

7. The sprint run is not fixed until the final local default branch contains the merge commit and the run is terminal `completed`.

## Dirty Checkout Cases

Exercise these cases with an approved local test project or a temporary fixture:

| Case | Setup | Expected behavior |
| --- | --- | --- |
| Clean checkout | No uncommitted files. | Temporary worktree merges sprint feature branch into default branch. |
| Dirty non-conflicting file | Modify a file outside the sprint diff. | Dirty work is committed to `dirty-ref-<uuid>`, final sprint merge completes, dirty branch merges back if clean. |
| Dirty conflicting file | Modify the same path as sprint output. | Dirty work is preserved on `dirty-ref-<uuid>`, sprint merge completes, dirty branch remains as backup if it cannot merge cleanly. |
| Checked-out default branch | Visible checkout is on the default branch. | After final merge, visible checkout refreshes to the merged commit. |
| Checked-out non-default branch | Visible checkout is on a worker or unrelated branch. | Final merge updates the default branch without switching the visible checkout. |

## Failure Triage Map

| Symptom | First place to inspect | Likely issue |
| --- | --- | --- |
| Running sprint only emits heartbeats after all tasks complete. | `watch-loop-core` finalization tests, sprint run events. | LOCAL run is waiting on remote-style main merge state instead of entering host merge. |
| Main-merge attention opens and closes repeatedly. | `project_attention_items`, worker-owned conflict tests. | Remote feedback reconciliation is clearing LOCAL worker-owned attention. |
| Final merge fails only when visible checkout has edits. | `local-merge.test.ts`, dirty checkout branches. | Dirty preservation or refresh behavior regressed. |
| Dependent tasks never start after a worker branch completes. | `feature-pr-gate.test.ts`, task merge indicators. | Worker branch merge evidence is missing or stale. |
| Mockup merge E2E passes but live provider fails. | Provider invocation row, Docker logs, provider transcript metadata. | Provider-specific output, workspace, or session-sync issue rather than orchestration policy. |
| Mockup merge E2E selects a credentialed provider. | `provider_invocations`, mockup runner `server.log`, virtual-worker provider pool. | The credential-free mockup route is being filtered before virtual-worker conflict or CI repair. |
| 100+ task mockup DAG progresses slowly while provider calls complete quickly. | `task_runs`, `task_dispatches`, `provider_invocations`, `ProviderConcurrencyService.getGlobalRunningCounts`. | Scheduler capacity is counting provider invocations only, so queued CLI task runs overload session sync and dispatch state. |

## Performance Guardrails

- Provider-specific live usage sync must only run for the matching provider. Jules live invocation sync and token estimation are Jules-only; mockup, Codex, Gemini, Claude Code, Qwen, OpenCode, and Antigravity CLI sessions should not enter Jules usage code paths.
- Provider-cap admission should happen before dispatch whenever the provider can be resolved from task routing. This keeps unlocked tasks pending instead of creating hidden running backlog.
- If a lower provider stage still reports `ProviderCapReachedError` after dispatch rows were created, the dispatch must be restored to `queued`, the task run to `PENDING`, and the project task to `pending`. Capacity deferral is not a task failure.
- Global provider counts should use the larger of running provider invocations and running task runs. CLI task runs can exist before their provider invocation starts.
- Expected terminal-session activity skips should be debug-level. Warning-level logging is reserved for foreign-session matches or data-integrity risks.

## Long-Running Memory Profile

After the merge behavior is fixed and deterministic lanes pass, run a long profile against compiled-runtime mockup scenarios:

```bash
pnpm run build
node --expose-gc --trace-gc dist/index.js
```

In a second terminal, run one or more mockup lanes against the compiled runtime or use the isolated runner:

```bash
pnpm run test:orchestration:full
```

Capture periodic process statistics while the lane runs:

```bash
while sleep 30; do
  date -Is
  ps -o pid,ppid,rss,vsz,pcpu,pmem,etime,command -C node
done
```

For leak-focused diagnostics, collect heap snapshots around stable checkpoints with Node inspector or `SIGUSR2` if the active runtime was started with heap-snapshot support. Compare memory after startup, after first task completion, after final merge, and after cleanup. A passing profile returns near its post-start steady state after Docker worktrees, provider watchers, preview sessions, and memory-promotion jobs settle.

## Exit Criteria

Treat an orchestration fix as ready only when:

- `pnpm run test:orchestration:rapid` passes.
- `pnpm run test:orchestration:merge-e2e` passes for merge-related fixes.
- `pnpm run test:orchestration:full` passes for scheduler, provider, CI, QA, or multi-project changes.
- The approved local test project reaches terminal `completed` after the relevant dirty-checkout or conflict scenario.
- The local default branch contains the expected final merge commit.
- No stale open attention remains for a completed run.
- `pnpm run lint` and `pnpm run build` pass before opening a PR.
