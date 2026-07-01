1. **Update `src/domain/settings/settings-schema.ts`**
   - Use `replace_with_git_merge_diff` to modify `validateSettingsPayload` to enforce that `dbRetentionDays` is a positive number >= 1 and <= 3650.
2. **Verify `src/domain/settings/settings-schema.ts` update**
   - Run `git diff src/domain/settings/settings-schema.ts` using `run_in_bash_session`.
3. **Update `src/services/database-maintenance-service.ts`**
   - Use `replace_with_git_merge_diff` to add `DatabaseMaintenanceResult` interface.
   - Use `replace_with_git_merge_diff` to modify `runMaintenance`, `pruneData`, `vacuumDatabases`, and `checkpointWalDatabases` to collect and return the results.
   - Use `replace_with_git_merge_diff` to add clamping for `dbRetentionDays` inside `runMaintenance`.
4. **Verify `src/services/database-maintenance-service.ts` update**
   - Run `git diff src/services/database-maintenance-service.ts` using `run_in_bash_session`.
5. **Create `tests/backend/services/database-maintenance-service.test.ts`**
   - Use `write_file` to create the test file with test cases covering: disabled pruning, disabled vacuum, invalid retention values, WAL checkpoint failures, and successful pruning.
6. **Verify `tests/backend/services/database-maintenance-service.test.ts` creation**
   - Run `cat tests/backend/services/database-maintenance-service.test.ts` using `run_in_bash_session`.
7. **Update `docs/operations/runbook.md`**
   - Use `replace_with_git_merge_diff` to document `dbAutoVacuumOnStartup`, `dbPruningEnabled`, and `dbRetentionDays`, their skip behaviors, and startup logs.
8. **Verify `docs/operations/runbook.md` update**
   - Run `git diff docs/operations/runbook.md` using `run_in_bash_session`.
9. **Run tests**
   - Run `pnpm run test:backend -- tests/backend/services/database-maintenance-service.test.ts` and `pnpm run lint` using `run_in_bash_session`.
10. **Pre-commit**
    - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
11. **Submit**
    - Submit the code change using the `submit` tool.
