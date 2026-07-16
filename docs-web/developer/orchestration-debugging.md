# Rapid orchestration debugging suite

Use this suite when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix. CI runs the Linux Docker and macOS/Windows Electron QA DAG rows on both `dev` and `main`; its Linux run waits for a durable task transition before restarting the isolated runtime twice during active QA work. If startup finds a QA row without its structured invocation, or finds an invocation that never linked to provider runtime, it cancels and retries that row immediately. An interrupted reviewer may resume its preserved workspace only while completing the same partial review cycle; verification after a decisive verdict always starts from a fresh branch snapshot. Only completed review verdicts count toward QA pass/fail history. The runner also requires bounded status observations around every restart, task QA start and completion evidence, ordered changes-requested-to-pass follow-up, merged terminal tasks, passing sprint QA, and a completed sprint. Full browser, release-candidate, and mockup pentest lanes are reserved for `main` validation or manual escalation.

## Commands

| Lane | Command | Purpose |
| --- | --- | --- |
| Fast regressions | `pnpm run test:orchestration:rapid` | Watch-loop, feature merge, and local final-merge regressions without Docker or provider CLIs. |
| CI DAG E2E | `pnpm run test:orchestration:ci-dag` | Linux CI lane coverage for task QA pass, QA decline/follow-up on the worker branch, sprint QA, and final integration. |
| Electron CI DAG | `pnpm run test:orchestration:ci-dag:electron` | macOS and Windows CI lane coverage for the same QA graph through the native Electron desktop app. |
| Mockup merge E2E | `pnpm run test:orchestration:merge-e2e` | Compiled runtime plus `mockup-cli` through a deterministic local merge-conflict DAG. |
| Full mockup pentest | `pnpm run test:orchestration:full` | Manual escalation for all deterministic mockup scenarios: smoke, CI repair, merge conflict, parallel DAG, dirty checkout, multi-project overrides. |
| Large DAG stress | `pnpm run test:orchestration:large-dag` | Heavy 129-task mockup DAG with wide fan-out and layered joins. |
| Full heavy pentest | `pnpm run test:orchestration:pentest` | Default mockup catalog plus heavy stress scenarios. |
| Extreme DAG recovery | `pnpm run test:orchestration:extreme-dag` | Local-only 400-task adversarial DAG, eight runtime restarts, QA context-cap validation, and resource ceilings; never runs in CI. |
| Backend broadening | `pnpm run test:backend` | Full backend suite after focused fixes. |
| Release validation | `pnpm run lint && pnpm run build` | Type safety and compiled server/dashboard output. |

## Escalation ladder

Start with `pnpm run test:orchestration:rapid`. It covers provider routing, watch-loop finalization, feature branch merge gates, local final merges, dirty checkout preservation, and worker-owned merge attention regressions.

Run `pnpm run test:orchestration:ci-dag` for the Linux no-secret CI lane. It builds the compiled runtime and exercises the deterministic QA mockup DAG through Docker-backed provider workspaces.

Run `pnpm run test:orchestration:ci-dag:electron` for the native macOS and Windows Electron lane. It launches `dist/electron/main.js`, waits for the embedded Code UX server, and runs the same QA DAG shape through a host-execution mockup fixture.

In GitHub Actions, `08 Orchestration` is one OS matrix: Linux runs the Docker-backed compiled-runtime DAG, and macOS/Windows run the Electron DAG with Electron binary install and native dependency rebuild exposed as separate steps. Each DAG job has a 25-minute workflow timeout, and the mockup runner bounds individual HTTP calls at 60 seconds plus the full project run at the configured `--timeout-ms`. During orchestration, it streams redacted runtime stdout/stderr, emits `mockup_pentest_progress` records on sprint/task changes plus 15-second heartbeats, fails after `--stall-timeout-ms 180000` when no sprint, task status, merge, expected-output state, or explicitly requested completed runtime restart changes after polling starts, and writes a final Markdown table to `GITHUB_STEP_SUMMARY`. Progress records contain status counts and at most 32 changed tasks rather than repeating a wide DAG on every heartbeat; failures retain the full snapshot. Successful status reads are retained in a bounded trace without resetting the no-state-progress timer. Finite completed restart events reset the watchdog so the configured interval measures post-recovery progress; admission heartbeats and failed restart attempts do not. Claimed tasks waiting on adaptive CPU/memory admission persist low-frequency wait events and dispatch heartbeats; the runner emits `mockup_pentest_provider_admission_wait` for diagnosis, but those heartbeats do not reset the no-state-progress stall timer.

## Local Branch Merge Drain

The local session snapshot used for watch-loop state matching excludes stored CLI prompts. Full prompts remain available through direct session and invocation reads, while large QA or planning payloads are not decoded into the server heap on every watch cycle.

The orchestrator performs a final branch-only merge drain immediately before rendering merge protocol instructions during an `orchestrate` cycle. This handles fast local CLI tasks that finish and push a worker branch after the earlier merge-gate snapshot but before protocol handling. If the CI DAG artifact shows a task stuck at `coding_completed` with `mergeIndicator: null`, a `cli_git_pushed` event, and a later `protocol_merge_required` event, inspect this final drain before increasing stall timeouts or rerunning blindly.

The compact DAG's final validation command runs as a scenario-level assertion after all task branches have merged, not inside the final worker worktree. During polling, the runner also enforces the declared DAG: a task with dependencies may not leave `pending` until each dependency is marked merged. If a future task starts early, the runner emits `mockup_pentest_dependency_merge_violation` and fails the test run immediately. The runner does not treat a completed sprint as terminal for these scenarios until expected repository files are visible in the project checkout; while it waits, it emits `mockup_pentest_waiting_for_expected_output`, but only an actual expected-output readiness change refreshes the stall watchdog. This keeps native Electron runners from validating against a dependency branch before Windows has made the parent merge visible, while still failing within the configured stall timeout if a completed sprint never exposes the merged files.

The Playwright workflow keeps lightweight legacy aggregate jobs named `Playwright E2E Tests (ubuntu-latest)`, `Playwright E2E Tests (macos-latest)`, and `Playwright E2E Tests (windows-latest)`. They depend on the split Playwright shard matrix so protected-branch required contexts stay compatible while the real coverage remains purpose-grouped.

In LOCAL git mode, recovered worker-branch evidence is dependency state: downstream DAG tasks stay blocked until the parent branch has merged into the sprint feature branch or the parent is proven to have no merge work.

Local CLI git finalization is also branch-evidence state. If a `cli_git_pushed` task-run event records a `pushedBranch`, the merge gate backfills that worker branch before dependency derivation. If a restart lands after the feature ref is updated but before merge metadata is persisted, recovery proves the surviving worker branch is already an ancestor of the feature branch and restores `isMerged`, `MERGED`, and the `merged_branch` event before downstream tasks unlock. If pushed git work is recorded but no worker branch can be recovered, the task fails closed in `MERGE_BLOCKED` instead of settling as no-output work, so downstream DAG tasks cannot start against an incomplete feature branch. Sprint finalization also reads that task-run evidence; a flattened `COMPLETED` task row cannot close the sprint while pushed local CLI work is still missing a `merged_branch` or `no_merge_work` gate event.

Host-execution DAG tasks export worker output through an isolated temporary Git index. The exporter uses Git's ignore-aware changed-path discovery, stages modified/deleted/untracked paths into that index, and emits a cached binary diff so parent-created files are present before dependent tasks unlock without committing runtime caches. Host worktrees use an absolute temporary index path, while Docker workspaces keep a container-relative path, so Git for Windows and container Git both write the export index in the intended workspace.

Generated local task branches use short, hash-stable `task/...` refs. This keeps native Windows worktree setup inside Git's ref path limits while preserving a deterministic prefix for task-specific branch recovery.

The fast branch-only merge gate evaluates completed candidate tasks, then reconciles the returned candidate projection back into the full DAG before dependency re-derivation so recovered merge state cannot be discarded.

Run `pnpm run test:orchestration:merge-e2e` after a unit-level merge fix passes. It builds the compiled runtime and exercises the `merge-conflict-dag` mockup scenario through the local project runtime.

Run `pnpm run test:orchestration:full` manually when a scheduler, provider, CI, QA, or multi-project orchestration issue needs broader compiled-runtime evidence. It executes every deterministic mockup scenario and writes artifacts under `.cache/e2e-mockup-sprint-pentest/<run-id>/`.

Run `pnpm run test:orchestration:large-dag` for a heavy 129-task DAG with 96 leaf tasks, 24 batch joins, 6 group joins, one final manifest, and one validation task. Use `pnpm run test:orchestration:pentest` for the default catalog plus heavy stress scenarios.

Run `pnpm run test:orchestration:extreme-dag` only as an explicit local pentest. It creates 400 deterministic tasks with wide, distant, diagonal, no-change, and long-tail dependency cases; runs task QA across every output-producing task including one changes-requested/follow-up/pass cycle; requires sprint QA and routed sprint-level CI repair; restarts the complete isolated runtime eight times; and enforces exact graph, merge, final-output, RSS, WAL, task-run, event, invocation, and 16-active-reservation scheduler invariants. The helper contract permits one project Git helper and at most 16 concurrent workspace sidecars; the restart contract caps failed task runs at 160 and final task-attempt amplification at 1.45, while the Docker contract requires zero non-running owner-scoped containers in the final sample. The sampler uses `docker ps -a`, so `created`, exited, and dead leaks are visible. p50 ceilings are 20 seconds for preparation, 10 seconds for Git finalization, and 35 seconds for the complete CLI workflow. Task QA contains full details only for the current task plus title-only completed siblings. Inert instruction padding pushes the unshortened sprint-QA context above 100,000 estimated tokens, every executable directive remains in the retained first half, and separate task/sprint prompt-size assertions prove both policies engaged. Restart-interrupted coding charges are refunded idempotently per task run, so the restart storm cannot exhaust a healthy task's coding guardrail. It is marked `localOnly`, so `all`, `pentest`, and CI never select it. Resource samples and final phase percentiles are retained in the project-run `resource-samples.json` artifact.

## Local merge checklist

If a live provider invocation reports `container ... is not running` while an isolated restart test
is active, compare its timestamps with the test's restart events. Current builds label every managed
Docker asset with a state-home-derived runtime owner; startup cleanup and shutdown select only that
owner. Warm-helper retries invalidate only the failed generation and fall back to one-shot execution
if the replacement also stops.

If Jules session creation returns HTTP `400` for several ready tasks, inspect the bounded provider
message on the execution invocation. Active-session/concurrency responses must leave the dispatch
queued and enter learned-cap backoff; source or branch validation responses remain failures with
their provider explanation. If restart marks a Jules task failed while Jules still reports it
active, compare the linked task run and invocation timestamps: startup recovery must restore remote
active truth before terminal local reconciliation.

1. Confirm `/ready` is healthy.
2. Inspect `sprint_runs`, run events, and active `project_attention_items` in `~/.code-ux/app.db`.
3. Inspect the approved local test repository with `git status --short --branch` and `git log --oneline --decorate`.
4. Keep a dirty visible checkout during one validation pass when debugging LOCAL finalization.
5. Verify worker-owned main-merge attention remains open until an actual temporary-worktree merge succeeds.
6. Verify the final local default branch contains the merge commit and the run is terminal `completed`.

## Merge-Conflict Attention Churn

If a task shows `MERGE_CONFLICT` while the matching attention item opens and immediately dismisses, inspect the resolved worker item payload. Rows with `branchMergeRetryConsumed: true` must not suppress a fresh conflict marker after the retry fails. Use `project_attention_items.payload_json`, the task `merge_indicator`, and runtime status sync logs to confirm the consumed retry is ignored by suppression.

If a temporary-worktree merge fails with `fatal: not a git repository: /workspace/.git/worktrees/...`, inspect the temp worktree `.git` file. Containerized `git worktree add` must be followed by relative gitdir normalization so later helper-container Git calls resolve the same host repository instead of a stale container path.

## Dirty checkout cases

| Case | Expected behavior |
| --- | --- |
| Clean checkout | Temporary worktree merges sprint feature branch into default branch. |
| Dirty non-conflicting file | Dirty work is committed to `dirty-ref-<uuid>`, final sprint merge completes, and the dirty work is copied back into the visible checkout as uncommitted changes. |
| Dirty conflicting file | Dirty work is preserved, sprint merge completes, restore is aborted, and the dirty branch remains as backup with a dashboard attention item. |
| Checked-out default branch | Visible checkout refreshes to the merged commit. |
| Checked-out non-default branch | Default branch updates without switching the visible checkout. |

## Provider concurrency checks

When a Docker-backed sprint appears capped but no matching provider containers are running, inspect `provider_invocations`, `task_dispatches`, and linked `task_runs`.

- Completed linked task runs or dispatches should release stale task-coding provider slots as `completed`.
- Recently heartbeating linked dispatches should remain active even if the short-lived provider container has already exited.
- Only idle/orphaned Docker provider rows should be failed for retry.

## Memory profile

Wide LOCAL DAG cycles batch latest task-run lookup for Git-finalization evidence. When profiling, repeated status-derivation or merge-protocol passes should not issue one latest-run query for every task, including tasks that have not started.

After deterministic lanes pass, run a long profile against compiled-runtime mockup scenarios:

```bash
pnpm run build
node --expose-gc --trace-gc dist/index.js
```

In another terminal, run:

```bash
pnpm run test:orchestration:full
```

Capture process statistics while the lane runs:

```bash
while sleep 30; do
  date -Is
  ps -o pid,ppid,rss,vsz,pcpu,pmem,etime,command -C node
done
```

For compiled-runtime stress runs, pass Node profiling flags to the isolated server child:

```bash
PROFILE_DIR=.cache/e2e-profiles/large-dag
mkdir -p "$PROFILE_DIR"
CODE_UX_E2E_SERVER_NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$PROFILE_DIR --cpu-prof-name=server.cpuprofile --heap-prof --heap-prof-dir=$PROFILE_DIR --heap-prof-name=server.heapprofile" \
  node scripts/e2e/run-mockup-sprint-pentest.mjs --scenario large-dag-stress --timeout-ms 3600000 --keep-artifacts
```

For restart stress, let Node auto-name the profile files so each restarted server child writes a separate CPU and heap profile:

```bash
PROFILE_DIR=.cache/e2e-profiles/large-dag-restarts
mkdir -p "$PROFILE_DIR"
CODE_UX_E2E_SERVER_NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$PROFILE_DIR --heap-prof --heap-prof-dir=$PROFILE_DIR" \
  node scripts/e2e/run-mockup-sprint-pentest.mjs --scenario large-dag-stress --timeout-ms 3600000 --restart-every-ms 45000 --restart-count 3 --keep-artifacts
```

Compare memory after startup, first task completion, final merge, and cleanup. A passing profile returns near its post-start steady state after Docker worktrees, provider watchers, preview sessions, and memory-promotion jobs settle.
