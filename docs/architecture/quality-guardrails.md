# Quality Guardrails

Code UX includes a lightweight local guardrail script for recurring hygiene risks that are easy to miss during focused feature work.

Run it with:

```bash
pnpm run quality:guardrails
```

The script is deterministic, uses only Node built-ins, and does not read build output or require network access. It scans production TypeScript and TSX under `src/`, `dashboard/src/`, and `scripts/`, while ignoring tests, `dist/`, coverage output, lockfiles, and generated dashboard build assets.

## What It Checks

- Blocking: backup and reject artifacts such as `.orig`, `.rej`, `.bak`, and editor `~` files under source and documentation roots.
- Blocking: placeholder dependency wiring in `src/app/dependency-factory/**/*.ts`, including empty-object casts such as `{} as any`, `{} as unknown`, double casts through `any` or `unknown`, and empty objects cast directly to service-like dependency types.
- Blocking: replayable persistence regressions for heavy dashboard snapshot events. The realtime event repository must only insert replayable events into `dashboard_realtime_events`, and snapshot publish tasks for `project.live.updated`, `project.execution.updated`, `project.runtime_status.updated`, `projects.updated`, and `overview.telemetry.updated` must publish with `replayable: false`.
- Blocking: duplicate adjacent optimistic task insertion calls in `dashboard/src/v2/TasksPage.tsx` or the task board action helper. New task creation should insert one optimistic record and remove it after the confirmed refresh.
- Blocking: substantial duplicate implementation blocks across production TypeScript and TSX. The duplicate scanner normalizes formatting, ignores imports and type-only declarations, and suppresses common JSX/Tailwind class fragments before comparing blocks.
- Advisory: production TypeScript or TSX files above the configured line threshold.
- Advisory: broad `any` patterns such as `: any`, `as any`, `Array<any>`, and `Record<..., any>`.

The script exits nonzero for high-confidence stale artifacts, duplicate implementation blocks, and the blocking regression patterns above. Oversized files and existing broad `any` usage are reported as hotspots so maintainers can improve them during nearby work without breaking CI on accepted legacy debt.

## Regression Rationale

Dependency factory wiring is allowed to use the typed `LateBoundDependency<T>` holder when construction order requires a synchronous link after related services are created. Empty-object casts hide missing links until runtime and can bypass the explicit "not linked" errors that late-bound holders provide.

Dashboard snapshot events are intentionally non-replayable because their payloads are large and quickly superseded by a fresh snapshot. Persisting those payloads in SQLite recreates the write-amplification problem that the realtime sequence watermark design removed.

The Tasks page uses optimistic records to make task creation feel immediate before the backend confirms and refreshes the board. A duplicated adjacent insertion shows the same optimistic task twice and is easy to reintroduce during local edits, so the guardrail blocks that narrow pattern without scanning unrelated state updates.

## Manual Regression Checks

The duplicate-code detector has focused Vitest coverage under `tests/backend/scripts/quality-guardrails.test.ts`. When changing the full guardrail script, also verify it directly:

```bash
pnpm run quality:guardrails
```

For targeted manual failure checks, temporarily introduce one of these local-only changes and confirm the command exits nonzero with the file, pattern, and remediation in the output, then remove the change:

- Add `const placeholder = {} as any;` to a file under `src/app/dependency-factory/`.
- Remove `replayable: false` from the `buildPublishTask` call to `publishRawEvent` in `src/services/dashboard-realtime-service.ts`.
- Duplicate the adjacent `setOptimisticTasks((prev) => [optimisticTask, ...prev]);` create path call in `dashboard/src/v2/TasksPage.tsx`.

## Thresholds

Current defaults:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `CODEUX_GUARDRAIL_MAX_LINES` | `800` | Maximum advisory line count for production TypeScript and scripts. |
| `CODEUX_GUARDRAIL_DASHBOARD_MAX_LINES` | `800` | Dashboard-specific advisory line count. |
| `CODEUX_GUARDRAIL_DUPLICATE_MIN_LINES` | `80` | Minimum normalized implementation lines before a duplicated block can fail the guardrail. |
| `CODEUX_GUARDRAIL_DUPLICATE_MIN_TOKENS` | `700` | Minimum normalized token count before a duplicated block can fail the guardrail. |
| `CODEUX_GUARDRAIL_REPORT_LIMIT` | `20` | Maximum entries shown per advisory section. |

Tune thresholds by raising or lowering the environment variables when running the script. Do not lower expectations by hiding risky files permanently; if a threshold needs to change, keep it paired with a rationale and a plan to reduce oversized modules or broad `any` usage over time.
