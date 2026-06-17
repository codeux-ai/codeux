1. **Create Sprints Page View Models File**
   - Use the `write_file` tool to create `dashboard/src/v2/pages/sprints/sprints-page-view-models.ts`.
   - Export pure functions (e.g., `buildActualActiveRunsMap`, `buildActiveRunsMap`, `buildPauseResumeRunsMap`, `buildDisplaySprints`, `buildSortedSprints`, `buildShowcaseSprints`, `countSprintsByStatus`, `buildPlanningConnection`, `buildPlanningRoute`, `buildVirtualProviders`).
   - Move the logic from `useSprintsPageData`'s `useMemo` hooks into these pure functions.

2. **Update `useSprintsPageData.ts`**
   - Use the `replace_with_git_merge_diff` tool to replace the `useMemo` blocks with calls to the extracted pure functions.
   - Import the new view-model helper functions into `dashboard/src/v2/pages/sprints/use-sprints-page-data.ts`.

3. **Add Tests for View Models**
   - Use the `write_file` tool to create `tests/dashboard/v2/pages/sprints/sprints-page-view-models.test.ts`.
   - Write tests covering connection role/status priority ordering, virtual worker route labeling, suppressed running sprint handling, optimistic status override, and sprint count calculations.

4. **Update Dashboard Guide**
   - Use the `replace_with_git_merge_diff` tool to update `docs/dashboard/dashboard-guide.md` with a note regarding the Sprints page data/view-model split under the Frontend Architecture Notes section.

5. **Pre-commit Steps**
   - Run `pre_commit_instructions` tool to execute pre commit steps to ensure proper testing, verification, review, and reflection are done.

6. **Submit Changes**
   - Run verification (e.g., `pnpm run typecheck:dashboard`, `pnpm run test:dashboard -- tests/dashboard/v2/pages/sprints/sprints-page-view-models.test.ts`).
   - Use the `submit` tool to create a branch and push changes.
