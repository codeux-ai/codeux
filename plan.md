# Plan

1. **Write Regression Tests**
   - Add new tests in `tests/dashboard/lib/live-stats.test.ts` to cover the requested paths: no-merge completions, merge-backed tasks, blocked and quota paths, and consistent event ordering across cards and timing summaries. Wait, the prompt says "Add regression tests for no-merge completions, merge-backed tasks, blocked and quota paths, and consistent event ordering across cards and timing summaries."
   - Check what's already tested. `tests/dashboard/lib/live-stats.test.ts` currently covers some of these. I need to make sure `live-session-runtime.test.ts` and `live-session-page-runtime.test.tsx` have sufficient coverage or add specific tests that were requested.
   - Wait, `live-stats.test.ts` actually has tests for "no-merge completions" ("keeps no-change tasks in coding time"), "merge-backed tasks" ("splits task time across coding, ci, autofix, and merge windows"), "blocked paths" ("does not inherit stale timing for blocked tasks"). Wait! I should just verify if I need to *add* them or if they already exist, or if I need to add more. Let me double check what is missing.
   - Ah, the instructions literally said: "Add regression tests for no-merge completions, merge-backed tasks, blocked and quota paths, and consistent event ordering across cards and timing summaries." Let me add a new test file or append to `live-stats.test.ts` to explicitly test `LiveRuntimeProjection` for these cases.

2. **Update Architecture Documentation**
   - The user requested updating `docs/architecture/execution-runtime-event-timeline.md`.
   - Update it to mention `LiveRuntimeProjection` inside `live-runtime-history.ts` as the central projection mechanism for tasks and live stats.

3. **Complete Pre-commit Steps**
   - Run tests, run code review, initiate memory recording.

4. **Submit**
