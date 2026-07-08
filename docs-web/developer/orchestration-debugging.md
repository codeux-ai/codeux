# Rapid orchestration debugging suite

Use this suite when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix.

## Commands

| Lane | Command | Purpose |
| --- | --- | --- |
| Fast regressions | `pnpm run test:orchestration:rapid` | Watch-loop, feature merge, and local final-merge regressions without Docker or provider CLIs. |
| Mockup merge E2E | `pnpm run test:orchestration:merge-e2e` | Compiled runtime plus `mockup-cli` through a deterministic local merge-conflict DAG. |
| Full mockup pentest | `pnpm run test:orchestration:full` | All deterministic mockup scenarios: smoke, CI repair, merge conflict, parallel DAG, dirty checkout, multi-project overrides. |
| Large DAG stress | `pnpm run test:orchestration:large-dag` | Heavy 129-task mockup DAG with wide fan-out and layered joins. |
| Full heavy pentest | `pnpm run test:orchestration:pentest` | Default mockup catalog plus heavy stress scenarios. |
| Backend broadening | `pnpm run test:backend` | Full backend suite after focused fixes. |
| Release validation | `pnpm run lint && pnpm run build` | Type safety and compiled server/dashboard output. |

## Escalation ladder

Start with `pnpm run test:orchestration:rapid`. It covers provider routing, watch-loop finalization, feature branch merge gates, local final merges, dirty checkout preservation, and worker-owned merge attention regressions.

Run `pnpm run test:orchestration:merge-e2e` after a unit-level merge fix passes. It builds the compiled runtime and exercises the `merge-conflict-dag` mockup scenario through the local project runtime.

Run `pnpm run test:orchestration:full` before calling a scheduler, provider, CI, QA, or multi-project orchestration issue fixed. It executes every deterministic mockup scenario and writes artifacts under `.cache/e2e-mockup-sprint-pentest/<run-id>/`.

Run `pnpm run test:orchestration:large-dag` for a heavy 129-task DAG with 96 leaf tasks, 24 batch joins, 6 group joins, one final manifest, and one validation task. Use `pnpm run test:orchestration:pentest` for the default catalog plus heavy stress scenarios.

## Local merge checklist

1. Confirm `/ready` is healthy.
2. Inspect `sprint_runs`, run events, and active `project_attention_items` in `~/.code-ux/app.db`.
3. Inspect the approved local test repository with `git status --short --branch` and `git log --oneline --decorate`.
4. Keep a dirty visible checkout during one validation pass when debugging LOCAL finalization.
5. Verify worker-owned main-merge attention remains open until an actual temporary-worktree merge succeeds.
6. Verify the final local default branch contains the merge commit and the run is terminal `completed`.

## Dirty checkout cases

| Case | Expected behavior |
| --- | --- |
| Clean checkout | Temporary worktree merges sprint feature branch into default branch. |
| Dirty non-conflicting file | Dirty work is committed to `dirty-ref-<uuid>`, final sprint merge completes, dirty branch merges back if clean. |
| Dirty conflicting file | Dirty work is preserved, sprint merge completes, dirty branch remains as backup if it cannot merge cleanly. |
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

Compare memory after startup, first task completion, final merge, and cleanup. A passing profile returns near its post-start steady state after Docker worktrees, provider watchers, preview sessions, and memory-promotion jobs settle.
