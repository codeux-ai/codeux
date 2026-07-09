# Rapid orchestration debugging suite

Use this suite when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix. CI uses the compiled 10-task DAG lane by default; full mockup pentest lanes are manual escalation tools for targeted investigations.

## Commands

| Lane | Command | Purpose |
| --- | --- | --- |
| Fast regressions | `pnpm run test:orchestration:rapid` | Watch-loop, feature merge, and local final-merge regressions without Docker or provider CLIs. |
| CI DAG E2E | `pnpm run test:orchestration:ci-dag` | Compiled runtime plus `mockup-cli` through a 10-task dependency graph with parallel leaves and layered joins. |
| Electron CI DAG | `pnpm run test:orchestration:ci-dag:electron` | Electron runtime plus the same 10-task graph through the native desktop app on Windows and macOS `main` validation. |
| Mockup merge E2E | `pnpm run test:orchestration:merge-e2e` | Compiled runtime plus `mockup-cli` through a deterministic local merge-conflict DAG. |
| Full mockup pentest | `pnpm run test:orchestration:full` | Manual escalation for all deterministic mockup scenarios: smoke, CI repair, merge conflict, parallel DAG, dirty checkout, multi-project overrides. |
| Large DAG stress | `pnpm run test:orchestration:large-dag` | Heavy 129-task mockup DAG with wide fan-out and layered joins. |
| Full heavy pentest | `pnpm run test:orchestration:pentest` | Default mockup catalog plus heavy stress scenarios. |
| Backend broadening | `pnpm run test:backend` | Full backend suite after focused fixes. |
| Release validation | `pnpm run lint && pnpm run build` | Type safety and compiled server/dashboard output. |

## Escalation ladder

Start with `pnpm run test:orchestration:rapid`. It covers provider routing, watch-loop finalization, feature branch merge gates, local final merges, dirty checkout preservation, and worker-owned merge attention regressions.

Run `pnpm run test:orchestration:ci-dag` for the no-secret CI lane. It builds the compiled runtime and exercises the deterministic 10-task mockup DAG through Docker-backed provider workspaces.

Run `pnpm run test:orchestration:ci-dag:electron` for the main-branch Electron lane. It launches `dist/electron/main.js`, waits for the embedded Code UX server, and runs the same 10-task DAG shape through a host-execution mockup fixture on native Windows and macOS runners.

In GitHub Actions, the CI DAG and Electron DAG lanes expose build, Electron binary install, native dependency rebuild, and orchestration as separate steps. During orchestration, the mockup runner streams redacted runtime stdout/stderr, emits `mockup_pentest_progress` records on sprint/task changes plus 15-second heartbeats, fails after `--stall-timeout-ms 180000` when no progress is observed, and writes a final Markdown table to `GITHUB_STEP_SUMMARY`.

In LOCAL git mode, recovered worker-branch evidence is dependency state: downstream DAG tasks stay blocked until the parent branch has merged into the sprint feature branch or the parent is proven to have no merge work.

Host-execution DAG tasks export worker output through an isolated temporary Git index. The exporter uses Git's ignore-aware changed-path discovery, stages modified/deleted/untracked paths into that index, and emits a cached binary diff so parent-created files are present before dependent tasks unlock without committing runtime caches. Host worktrees use an absolute temporary index path, while Docker workspaces keep a container-relative path, so Git for Windows and container Git both write the export index in the intended workspace.

The fast branch-only merge gate evaluates completed candidate tasks, then reconciles the returned candidate projection back into the full DAG before dependency re-derivation so recovered merge state cannot be discarded.

Run `pnpm run test:orchestration:merge-e2e` after a unit-level merge fix passes. It builds the compiled runtime and exercises the `merge-conflict-dag` mockup scenario through the local project runtime.

Run `pnpm run test:orchestration:full` manually when a scheduler, provider, CI, QA, or multi-project orchestration issue needs broader compiled-runtime evidence. It executes every deterministic mockup scenario and writes artifacts under `.cache/e2e-mockup-sprint-pentest/<run-id>/`.

Run `pnpm run test:orchestration:large-dag` for a heavy 129-task DAG with 96 leaf tasks, 24 batch joins, 6 group joins, one final manifest, and one validation task. Use `pnpm run test:orchestration:pentest` for the default catalog plus heavy stress scenarios.

## Local merge checklist

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
