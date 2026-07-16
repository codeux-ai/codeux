# Rapid Orchestration Debugging Suite

This suite is the escalation ladder for sprint orchestration failures. Use it when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix.

The suite is intentionally split into fast deterministic lanes and slower compiled-runtime lanes. CI runs the three-row compiled QA DAG on both `dev` and `main`, so pull requests exercise task QA, follow-up branch recovery, sprint QA, Docker-backed orchestration, and native Electron orchestration without running the full browser or release matrices. The Linux Docker lane also restarts the isolated runtime twice during the active QA DAG to cover startup reconciliation; macOS and Windows run the matching Electron QA DAG because Electron restart stress is not supported by this harness. The runner retains a bounded trace of successful status reads and durable QA-start events, then requires status observations before and after every restart, completed task-review outcomes, ordered changes-requested-to-pass follow-up, merged terminal tasks, passing sprint QA, and a completed sprint. Start with the smallest lane that can reproduce the issue, then broaden only after it passes.

## Lane Summary

| Lane | Command | Purpose | Expected runtime |
| --- | --- | --- | --- |
| Fast regressions | `pnpm run test:orchestration:rapid` | Watch-loop, feature merge, and local final-merge regressions without Docker or provider CLIs. | Seconds to a few minutes |
| CI DAG E2E | `pnpm run test:orchestration:ci-dag` | Compiled runtime plus `mockup-cli` through task QA pass, QA decline/follow-up on the worker branch, sprint QA, and a final DAG join. | Up to 20 minutes |
| Mockup merge E2E | `pnpm run test:orchestration:merge-e2e` | Compiled runtime plus `mockup-cli` through a deterministic local merge-conflict DAG. | Up to 15 minutes |
| Completion conflict E2E | `pnpm run test:orchestration:completion-conflict` | Compiled runtime final LOCAL merge conflict repair after default-branch mutation during orchestration. | Up to 20 minutes |
| Full mockup pentest | `pnpm run test:orchestration:full` | Manual escalation for all deterministic mockup scenarios: smoke, CI repair, merge conflict, parallel DAG, multi-project overrides. | Longer-running |
| Large DAG stress | `pnpm run test:orchestration:large-dag` | Heavy 129-task mockup DAG with wide fan-out and layered joins. | Long-running |
| Full heavy pentest | `pnpm run test:orchestration:pentest` | Default mockup catalog plus heavy stress scenarios. | Long-running |
| Extreme DAG recovery | `pnpm run test:orchestration:extreme-dag` | Local-only 400-task adversarial DAG, eight runtime restarts, and resource ceilings. Never runs in CI. | Very long-running |
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
- Dirty visible checkouts that must be preserved before final merge, including the rule that `.code-ux/` dirt is ignored.
- LOCAL no-PR task branch merges where untracked `.code-ux/**` files in the visible checkout would otherwise block `git checkout`.
- Worker-owned merge-conflict attention items being opened, resolved, or retried incorrectly.
- Mockup virtual-worker routes falling back to credentialed providers.
- Mockup virtual merge-conflict workers completing without removing active conflict markers.
- Virtual conflict repair falling back when container Git cannot list unresolved files with `git diff`.
- Virtual conflict repair auto-resolving `.code-ux/**` conflicts to the target branch side and reseeding invalid Docker repair workspaces before provider execution.
- Task dependency unlocks after worker branch merges into the sprint feature branch.

The lane must stay credential-free and isolated. It should mock provider, GitHub, Docker, and external network boundaries unless a test specifically targets host Git behavior.

## CI DAG E2E Lane

Run:

```bash
pnpm run test:orchestration:ci-dag
```

This builds the compiled runtime and executes `ci-qa-dag`, a deterministic four-task QA sprint:

- 1 root task that passes task-level QA.
- 1 dependent task that passes task-level QA.
- 1 dependent task that intentionally fails QA, receives a follow-up, and must pass QA on the same worker branch.
- 1 final join task plus a sprint-level QA gate and repository validation.

This is the Linux entry of the default no-secret GitHub Actions orchestration matrix for pushes and pull requests targeting `dev` or `main`. It is intentionally smaller than the heavy DAG stress lane but validates Docker-backed task dispatch, dependency unlocks, provider concurrency, task and sprint QA, worker-branch follow-up visibility, feature-branch merging, final repository assertions, and compiled-runtime startup. Its two restart checks wait until a task reaches `coding_completed` or `completed`, then require both runtime restarts to finish; this exercises recovery during active orchestration without repeatedly interrupting a cold Docker setup before it has persisted any work. If a restart finds a QA row without its structured invocation, or finds an invocation that never linked to provider runtime, startup recovery cancels and retries it immediately. An interrupted reviewer may resume its preserved workspace only while completing the same partial review cycle; verification after a decisive verdict always starts from a fresh branch snapshot. Only completed review verdicts count toward QA pass/fail history.

The same `08 Orchestration` matrix adds native Windows and macOS Electron DAG coverage:

```bash
pnpm run test:orchestration:ci-dag:electron
```

That lane launches the Electron app, waits for the embedded Code UX server, and runs the same QA DAG shape through a host-execution mockup fixture. It runs directly on the hosted OS because GitHub-hosted Windows and macOS runners do not provide Docker job containers.

In GitHub Actions, `08 Orchestration` runs build-artifact download, Electron binary install, native dependency rebuild, and orchestration as separate steps where applicable so a stall is visible at the step boundary. Each DAG job has a 25-minute workflow timeout, and the mockup runner bounds individual HTTP calls at 60 seconds plus the full project run at the configured `--timeout-ms`. The runner streams redacted runtime stdout/stderr and emits `mockup_pentest_progress` records whenever sprint or task state changes, plus heartbeat progress every 15 seconds. Progress records contain status counts and at most 32 changed tasks instead of repeating the entire wide DAG; failure records retain the full diagnostic snapshot. CI passes `--stall-timeout-ms 180000`; if no sprint, task status, merge, expected-output state, or explicitly requested completed runtime restart changes for three minutes after polling starts, the runner fails early with the last sprint/task snapshot and writes the final table to `GITHUB_STEP_SUMMARY`. Successful status observations are retained in a bounded diagnostic trace but do not reset the stall watchdog unless the existing progress signature changes. Finite completed restart events reset the watchdog so the configured interval measures post-recovery progress; admission heartbeats and failed restart attempts do not. A claimed task waiting for adaptive CPU/memory admission persists `provider_admission_waiting` / `provider_admission_wait_ended` task-run events and refreshes its dispatch heartbeat every ten seconds. The runner still reports this as `mockup_pentest_provider_admission_wait` for diagnosis, but a fresh admission heartbeat is liveness rather than task progress and cannot keep an unchanged scenario alive indefinitely.

For high-throughput diagnosis, distinguish a real state transition from a steady poll. Session sync writes task-run and dispatch rows only when provider-derived state changes; an otherwise unchanged active dispatch emits a liveness heartbeat no more than once per minute. The cycle runner owns the LOCAL Git-finalization evidence snapshot for the cycle and passes it into watch-loop terminal evaluation, while the feature gate reads each task's event history once per evaluation. Repeated source-keyed events that SQLite ignores do not invalidate wall-time caches or publish a dashboard refresh.

The local session snapshot used for state matching excludes stored CLI prompts. Full prompts remain available through direct session and invocation reads, while large QA or planning payloads are not decoded into the server heap on every watch cycle.

The default watch-loop interval is one second. This improves local task completion, merge-drain, and dependency-unlock latency; remote Git/CI refreshes retain their ten-second cache floor and provider-specific session clients keep their own throttling. Existing explicit project or sprint interval overrides are not migrated automatically.

The compact DAG's final validation command runs as a scenario-level assertion after all task branches have merged, not inside the final worker worktree. During polling, the runner also enforces the declared DAG: a task with dependencies may not leave `pending` until each dependency is marked merged. If a future task starts early, the runner emits `mockup_pentest_dependency_merge_violation` and fails the test run immediately. The runner does not treat a completed sprint as terminal for these scenarios until expected repository files are visible in the project checkout; while it waits, it emits `mockup_pentest_waiting_for_expected_output`, but only an actual expected-output readiness change refreshes the stall watchdog. This keeps native Electron runners from validating against a dependency branch before Windows has made the parent merge visible, while still failing within the configured stall timeout if a completed sprint never exposes the merged files.

The Playwright workflow keeps lightweight legacy aggregate jobs named `Playwright E2E Tests (ubuntu-latest)`, `Playwright E2E Tests (macos-latest)`, and `Playwright E2E Tests (windows-latest)`. They depend on the split Playwright shard matrix so protected-branch required contexts stay compatible while the real coverage remains purpose-grouped.

In LOCAL git mode, recovered worker-branch evidence is treated as dependency state: downstream DAG tasks stay blocked until the parent branch has merged into the sprint feature branch or the parent is proven to have no merge work.

Local CLI git finalization is also branch-evidence state. If a `cli_git_pushed` task-run event records a `pushedBranch`, the merge gate backfills that worker branch before dependency derivation. If a restart lands after the feature ref is updated but before merge metadata is persisted, recovery proves the surviving worker branch is already an ancestor of the feature branch and restores `isMerged`, `MERGED`, and the `merged_branch` event before downstream tasks unlock. If pushed git work is recorded but no worker branch can be recovered, the task fails closed in `MERGE_BLOCKED` instead of settling as no-output work, so downstream DAG tasks cannot start against an incomplete feature branch. Sprint finalization also reads that task-run evidence; a flattened `COMPLETED` task row cannot close the sprint while pushed local CLI work is still missing a `merged_branch` or `no_merge_work` gate event.

Host-execution DAG tasks export their worker output through an isolated temporary Git index. The exporter discovers modified, deleted, and untracked paths with Git's ignore rules, stages that path list into the temporary index, and emits a cached binary diff against the task base. Host worktrees use an absolute temporary index path, while Docker workspaces keep a container-relative path, so Git for Windows and container Git both write the export index in the intended workspace. This prevents ignored runtime caches from entering worker branches while ensuring parent-created files are visible before dependent tasks unlock.

Generated local task branches use short, hash-stable `task/...` refs. This keeps native Windows worktree setup inside Git's ref path limits while preserving a deterministic prefix for task-specific branch recovery.

The fast branch-only merge gate evaluates only completed candidate tasks, then reconciles the returned candidate projection back into the full DAG before dependency re-derivation. A gate result must never drop non-candidate tasks or discard recovered merge state.

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

Run this lane manually when a merge/orchestration incident needs broader compiled-runtime evidence beyond the rapid lane or a targeted E2E lane. It covers:

- `smoke-completion`: dependency-chain completion and final local repository assertions.
- `ci-qa-dag`: the CI-sized QA DAG used by the default no-secret workflow.
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

During a healthy run, the active task-run count should stay near the fixture provider cap. The mockup E2E runner raises the system mockup-provider ceiling to `32`, then each fixture applies its own lower cap. Regular wide Docker scenarios use `mockup-cli` with `maxConcurrentTasks: 5`; the 129-task stress fixture uses a dedicated Docker fixture with `maxConcurrentTasks: 12` so the lane completes in a practical time. The live database should show roughly that many `task_runs.state = 'RUNNING'` while the remaining unlocked work stays `pending`.

The provider call is not the only timing that matters. For Docker-backed CLI tasks, compare `cli_prepare_started -> cli_prepare_completed`, provider invocation duration, and `provider_completed -> git_pushed`. Wide DAGs should not show a staircase where each task's prepare phase starts only after another workspace seed finishes. Docker workspaces are independent volumes, so only same-workspace preparation and host `git worktree` metadata operations should serialize; repo-wide locks must not wrap Docker volume creation, bundle seeding, or checkout. Patch export should use Git's ignore-aware changed-path discovery and a temporary cached index so generated files, edits, and deletions export consistently without staging ignored runtime caches. Patch materialization on the host should also stay collapsed into one shell command for local mode and the non-network part of remote mode; remote fetch/push retry remains separate because it is network-sensitive.

Restart testing must preserve local CLI workspaces. Startup recovery may cancel and redispatch interrupted local CLI task runs, but it removes surviving task containers without deleting their workspace volumes and session sync treats any finished local CLI task run as terminal even when a stale cached session snapshot still says `RUNNING`.

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

## Extreme DAG Restart/Resource Lane

Run:

```bash
pnpm run test:orchestration:extreme-dag
```

This explicit local-only lane is not part of `all`, `pentest`, or any workflow. Its 400 tasks combine a 240-wide root fan-out, 80 three-way joins, distant half-graph joins, diagonal cross-layer dependencies, priority skew, asymmetric regional barriers, a no-change dependency gate, and a final recovery tail. Task QA is enabled for every output-producing task: 398 pass directly and one layer exercises changes requested, same-worker-branch coding follow-up, and a later pass. The sprint then requires sprint QA and a routed sprint-level CI-fix worker marker before final settlement. The package command restarts the entire isolated compiled runtime eight times after durable orchestration begins while retaining the same HOME, database, port, task workspaces, and Docker volumes.

Passing requires all 400 task rows to be completed and merge-safe, no dependency to start before every parent is merged, all expected task/sprint QA outcomes and the CI repair to complete, the final validation command to pass from the integrated default branch, and all eight restarts to finish. The runner also samples resources every five seconds and enforces a 1 GiB compiled-runtime RSS ceiling, a 512 MiB WAL ceiling, at most 16 dispatch-backed active task-run reservations (`PENDING`, `RUNNING`, or `PAUSED`), at most 560 total task runs, at most 40,000 task-run events, and at most 1,100 provider invocations. Pending status-projection rows without a dispatch do not reserve work and are excluded. Startup recovery refunds each runtime-interrupted task-coding charge exactly once using the task-run id; without that invariant, repeatedly interrupting the same deterministic wave can exhaust its coding guardrail and deadlock the remaining DAG. The row ceilings cover 400 successful coding attempts, the QA follow-up, task/sprint QA, routed CI repair, and the worst-case eight interrupted 16-wide waves with margin; they are not steady-state concurrency targets. Inspect `resource-samples.json` and the `runtimeResources` summary when a ceiling fails.

Progress events contain only the current delta and aggregate task counts. Full restart history is
retained once in the final summary rather than copied into every polling event, keeping multi-hour
local stress-test output bounded while preserving the recovery audit trail.

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
| Dirty non-conflicting file | Modify a file outside the sprint diff. | Dirty work is committed to `dirty-ref-<uuid>`, a dashboard notification names that branch, and the sprint merge completes without auto-merging the preserved branch. |
| Dirty conflicting file | Modify the same path as sprint output. | User dirty work is preserved on `dirty-ref-<uuid>`, a dashboard notification names that branch, and the sprint merge completes without auto-merging the preserved branch. |
| Dirty `.code-ux/` runtime file | Write or modify `.code-ux/**` during a LOCAL final merge. | Dirty preservation is skipped for those runtime artifacts and the sprint merge proceeds as if the checkout were clean. |
| Untracked `.code-ux/` file during task branch merge | Leave untracked `.code-ux/**` files in the visible checkout while completed CLI task branches wait for feature-branch merge. | The branch-only task merge runs in a temporary worktree, marks the tasks `MERGED`, clears task-run worker-branch evidence, and does not switch or clean the visible checkout. |
| Merge conflict only in `.code-ux/` | Create conflicting `.code-ux/**` edits on source and target branches. | Worker merge repair and LOCAL task-branch merges resolve those paths to the target branch side without dispatching a provider solely for Code UX artifacts. |
| Checked-out default branch | Visible checkout is on the default branch. | After final merge, visible checkout refreshes to the merged commit. |
| Checked-out non-default branch | Visible checkout is on a worker or unrelated branch. | Final merge updates the default branch without switching the visible checkout. |

## Failure Triage Map

| Symptom | First place to inspect | Likely issue |
| --- | --- | --- |
| Running sprint only emits heartbeats after all tasks complete. | `watch-loop-core` finalization tests, sprint run events. | LOCAL run is waiting on remote-style main merge state instead of entering host merge. |
| Main-merge attention opens and closes repeatedly. | `project_attention_items`, worker-owned conflict tests. | Remote feedback reconciliation is clearing LOCAL worker-owned attention. |
| Final merge fails only when visible checkout has edits. | `local-merge.test.ts`, dirty checkout branches. | Dirty preservation or refresh behavior regressed. |
| Dependent tasks never start after a worker branch completes. | `feature-pr-gate.test.ts`, task merge indicators. | Worker branch merge evidence is missing or stale. |
| Dependent tasks start before parent files are visible in their worktree. | `cycle-runner.test.ts`, fast branch-only gate logs, `mockup_pentest_progress`. | LOCAL worker-branch evidence was recovered after status derivation but did not trigger dependency re-derivation. |
| Branch-only gate logs completed parent candidates but every task still shows `isMerged=false`. | `cycle-runner.test.ts`, fast branch-only gate result reconciliation, task state snapshots. | The gate's returned candidate projection was not merged back into the full in-memory DAG before start-ready evaluation. |
| Parent DAG task completes but its generated files are missing from the worker branch. | `workspace-artifact-service.test.ts`, `cli_git_pushed` activity stats, final validation import errors. | Patch export skipped untracked files or treated ignored runtime caches as stageable paths; export must use an ignore-aware changed-path list and cached temporary-index diff. |
| Code-complete LOCAL task branches repeatedly become `MERGE_CONFLICT` but raw Git merges cleanly. | Fast branch-only gate logs, `local-merge.test.ts`, visible checkout status. | The visible checkout is blocking host `git checkout`; task branch settlement must use the temporary-worktree path instead of the visible worktree. |
| Temporary-worktree merges fail with `fatal: not a git repository: /workspace/.git/worktrees/...`. | `local-merge.test.ts`, helper-container Git logs, the temp worktree `.git` file. | Containerized `git worktree add` left an absolute container gitdir pointer behind. Code UX must normalize that pointer to a relative gitdir before the next helper-container Git command. |
| Mockup merge E2E passes but live provider fails. | Provider invocation row, Docker logs, provider transcript metadata. | Provider-specific output, workspace, or session-sync issue rather than orchestration policy. |
| Live provider fails with `container ... is not running` while an isolated restart test is active. | Compare the invocation timestamps with `runtime_restart_started` / `runtime_restart_completed`; inspect the container's `code-ux.runtime-owner` label. | An unowned or older runtime allowed its shutdown/startup cleanup to remove another runtime's warm helper. Current builds owner-scope every cleanup path; stopped-helper retries are generation-aware and fall back to one-shot execution. |
| A restart artifact records a provider container-name conflict before the old server exits. | Compare the failure timestamp with the restart request and server-exit timestamps; inspect the exact container's managed, runtime-owner, session, and state metadata. | Shutdown disposal relaunched an already-aborted spawner command, or an unsafe conflict handler targeted a live/foreign container. Aborted spawner commands must not fall back in-process; only a managed same-owner, same-session non-running `created`, `exited`, or `dead` container may be reclaimed. |
| Jules session creation fails repeatedly with HTTP `400` across ready tasks. | Read the bounded provider detail on the execution invocation and compare local running Jules claims with remotely active sessions. | A hosted active-session ceiling was treated as a task failure, or the source/branch request is invalid. Capacity-specific responses must queue/defer and back off; other validation responses must retain their exact provider explanation. |
| Restart marks Jules task runs failed while the provider still shows them active. | Compare `task_runs`, linked provider/execution invocations, and the Jules session state at the restart timestamp. | Local terminal sprint state overrode durable remote truth. Startup must restore remotely active, unmerged sessions before terminal dispatch/invocation reconciliation. |
| Mockup merge E2E selects a credentialed provider. | `provider_invocations`, mockup runner `server.log`, virtual-worker provider pool. | The credential-free mockup route is being filtered before virtual-worker conflict or CI repair. |
| Merge-conflict attention resolves but reopens until the guardrail escalates. | Task `merge_indicator`, project attention payload, virtual-worker resolution logs. | The worker resolved the branch but did not clear the stale task `MERGE_CONFLICT` marker, so the next protocol pass recreated the same conflict. |
| Merge-conflict attention resolves and the sprint pauses as generic manual attention. | Task `worker_branch`, `task_runs.worker_branch`, `git rev-list feature..worker`. | Resolved-conflict clear history is being reused as merge-required suppression. Suppression must apply only after the source branch has no commits ahead of the feature branch. |
| Human merge-conflict handoffs remain open after the task marker clears. | `project_attention_items.payload_json`, task `merge_indicator`, sprint cycle logs. | The cycle must dismiss only task-level handoffs whose payload source is `merge_conflict` and whose task no longer has `MERGE_CONFLICT`; main-merge/manual handoffs must remain open. |
| Code-complete tasks with completed task runs do not enter branch-only merge. | Compare subtask `worker_branch` with `task_runs.worker_branch`. | The branch-only gate must recover worker-branch evidence from the latest completed task run before calculating merge readiness. |
| 100+ task mockup DAG progresses slowly while provider calls complete quickly. | `task_runs`, `task_dispatches`, `provider_invocations`, `ProviderConcurrencyService.getGlobalRunningCounts`. | Scheduler capacity is counting provider invocations only, so queued CLI task runs overload session sync and dispatch state. |
| 100+ task mockup DAG stays capped correctly but each task takes tens of seconds. | Task-run activity timestamps around `cli_prepare_*`, provider invocation rows, and `git_pushed` events. | Git/workspace helpers are serializing independent Docker volume seeds or exporting patches with too many helper container round trips. |

## Performance Guardrails

- Provider-specific live usage sync must only run for the matching provider. Jules live invocation sync and token estimation are Jules-only; mockup, Codex, Gemini, Claude Code, Qwen, OpenCode, and Antigravity CLI sessions should not enter Jules usage code paths.
- Provider routing must resolve exact provider-config ids. A provider type such as `gemini` is valid only when a configured provider instance with id `gemini` exists; it must not silently select another instance such as `gemini-fast`. Sprint/project overrides may introduce a credential-free provider instance such as `mockup-cli`, and the sanitizer must preserve that instance before validating route providers, allowed-provider pools, worker providers, and per-route overrides.
- Project and sprint route-provider maps are replace-on-write for each invocation route. A scoped override for `task_coding.providers`, `merge_conflict.providers`, or `qa_review.providers` narrows that route to the declared provider-config ids instead of inheriting parent route providers and accidentally admitting live providers into a mockup-only run.
- Provider-cap admission should happen before dispatch whenever the provider can be resolved from task routing. This keeps unlocked tasks pending instead of creating hidden running backlog.
- If a lower provider stage still reports `ProviderCapReachedError` after dispatch rows were created, the dispatch must be restored to `queued`, the task run to `PENDING`, and the project task to `pending`. Capacity deferral is not a task failure.
- Global provider counts should use the larger of running provider invocations and running task runs. CLI task runs can exist before their provider invocation starts.
- CLI task runs should transition to `COMPLETED` immediately after the worker branch is materialized and `cli_git_pushed` is recorded. PR finalization may enrich the row with a PR URL afterwards, but it should not keep a provider slot reserved while code work is already complete.
- Docker workspace preparation must lock by workspace, not by repository. Host worktree mode still needs a repo lock around `git worktree` metadata, but Docker volume seeding and checkout should proceed concurrently for different task workspaces.
- LOCAL and REMOTE no-PR worker-branch merges should run through a temporary worktree; REMOTE pushes only the sprint feature branch after the merge. The visible project checkout should not be switched or dirtied by this path, and settled tasks should not keep stale worker-branch evidence in runtime projection.
- Feature-branch patch and merge publication must use compare-and-swap ref updates. A concurrent ref move is retried from the new tip; an unconditional `git update-ref` can erase a dependency merge even though the task was already marked merged.
- Exact remote branch fetches should be narrow and in-flight deduplicated per repo and branch. Do not reintroduce broad `git fetch origin` calls in the task prepare hot path.
- Docker workspace seed bundles should reuse identical targeted bundles across a concurrent wave. Reuse must be keyed by repo, exact ref list, and current ref tips, and should be short-lived; broad `--all` bundles are in-flight-only to avoid stale all-ref snapshots.
- Docker helper image readiness should be cached per process after a successful `docker image inspect`/pull. High-concurrency DAGs must not run `docker image inspect alpine/git` before every helper command.
- Docker patch export should remain a single workspace command with `git ls-files -z` piped through `xargs -0 git add --intent-to-add --`, followed by `git diff --binary`. This avoids repeated Docker helper startup and avoids passing large untracked path lists through host or Docker argv.
- Host patch materialization should remain a single shell command that applies the temporary index, writes the tree, creates the commit, updates the worker branch, optionally refreshes a clean checked-out worker branch, and emits `git diff --numstat` for activity stats. Local-git mode should not probe or push remotes during this stage.
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

## Local Branch Merge Drain

The orchestrator performs a final branch-only merge drain immediately before rendering merge protocol instructions during an `orchestrate` cycle. This handles fast local CLI tasks that finish and push a worker branch after the earlier merge-gate snapshot but before protocol handling. If the CI DAG artifact shows a task stuck at `coding_completed` with `mergeIndicator: null`, a `cli_git_pushed` event, and a later `protocol_merge_required` event, inspect this final drain before increasing stall timeouts or rerunning blindly.

## Exit Criteria

Treat an orchestration fix as ready only when:

- `pnpm run test:orchestration:rapid` passes.
- `pnpm run test:orchestration:ci-dag` passes for scheduler, Docker workspace, or workflow changes that affect the CI lane.
- `pnpm run test:orchestration:merge-e2e` passes for merge-related fixes.
- `pnpm run test:orchestration:full` is run only when the change specifically needs full mockup catalog coverage.
- The approved local test project reaches terminal `completed` after the relevant dirty-checkout or conflict scenario.
- The local default branch contains the expected final merge commit.
- No stale open attention remains for a completed run.
- `pnpm run lint` and `pnpm run build` pass before opening a PR.
