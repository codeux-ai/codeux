# Sprint 2 Task Plans

## Refactor Feature PR Gate into smaller policy units (T14)
1. Extract the merge-readiness decision matrix into a pure function `evaluateMergeReadiness` in `src/domain/sprint/ci/feature-pr/merge-readiness-policy.ts`.
   - The function `evaluateMergeReadiness` should take `checks`, `waitForFeatureCi`, `resolveAllCommentsBeforeFeatureMerge`, `reviewDecision`, and `comments` as inputs.
   - It will return an object with boolean flags: `hasFailedChecks`, `hasPendingChecks`, `hasReviewBlockers`, and `isMergeReady`.
2. Extract the CI autofix notification composition and retry escalation handling into `src/domain/sprint/ci/feature-pr/ci-autofix-policy.ts`.
   - Move `getCiAutofixRetryKey` (rename to `getCiAutofixRetryKey`), `resolveCiEscalationOwner` (rename to `resolveCiEscalationOwner`), and `notifyJulesAboutFailedCi` (rename to `notifyJulesAboutFailedCi`) from `FeaturePrGateService` to this new module as exported standalone functions.
   - Create a new exported function `handleCiAutofixEscalation` that encapsulates the logic inside the `if (context.ciIntelligence.waitForJulesCiAutofix)` block. It will return the updated `reportText` and mutate the `task` and `context.ciAutofixRetryCounts` as needed.
3. Extract report rendering into `src/domain/sprint/ci/feature-pr/ci-notification-builder.ts`.
   - Create individual exported functions to construct the report text strings.
   - Functions to create: `buildNoPrFoundText`, `buildAutoMergeSuccessText`, `buildAutoMergeFailedText`, `buildMergeReadyText`, `buildInProgressText`, `buildFailedChecksText`, `buildReviewBlockersText`.
4. Verify that the new files are created successfully using `ls` or `read_file`.
5. Refactor `src/domain/sprint/ci/feature-pr-gate.ts` to use `evaluateMergeReadiness` from `merge-readiness-policy.ts`.
6. Refactor `src/domain/sprint/ci/feature-pr-gate.ts` to use `handleCiAutofixEscalation` from `ci-autofix-policy.ts`.
7. Refactor `src/domain/sprint/ci/feature-pr-gate.ts` to use functions from `ci-notification-builder.ts` for text generation.
8. Verify that `feature-pr-gate.ts` is syntactically correct and imports are resolved by running `npm run typecheck`.
9. Create tests for `merge-readiness-policy.ts` in `tests/backend/domain/sprint/ci/feature-pr/merge-readiness-policy.test.ts`. Test combinations of failed checks, pending checks, and review blockers.
10. Create tests for `ci-autofix-policy.ts` in `tests/backend/domain/sprint/ci/feature-pr/ci-autofix-policy.test.ts`. Test the retry limit escalation trigger and notification sending behavior.
11. Create tests for `ci-notification-builder.ts` in `tests/backend/domain/sprint/ci/feature-pr/ci-notification-builder.test.ts`. Test the output formatting of `buildInProgressText` and `buildFailedChecksText`.
12. Verify tests pass (`npm run test -- tests/backend/domain/sprint/ci/feature-pr-gate.test.ts` and `npm run test -- tests/backend/domain/sprint/ci/feature-pr/`).
13. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
14. Submit the changes.

## Introduce RuntimeContext and Move Stateful Closures Out of JulesAgentServer (T07)
1. **Create `src/app/runtime-context.ts`:**
   - Define a `RuntimeContext` interface with methods for the mutable state:
     - `get settings(): Settings`
     - `set settings(value: Settings)`
     - `get dashboardSettings(): DashboardSettings | undefined`
     - `set dashboardSettings(value: DashboardSettings)`
     - `get consecutiveFailures(): number`
     - `set consecutiveFailures(value: number)`
     - `get lastStatus(): Partial<DashboardStatus> | null`
     - `set lastStatus(value: Partial<DashboardStatus> | null)`
     - `get dashboardRuntimePort(): number | null`
     - `set dashboardRuntimePort(value: number | null)`
   - Create a class `DefaultRuntimeContext` implementing `RuntimeContext`.
   - Verify creation using `cat src/app/runtime-context.ts`.

2. **Refactor `src/app/dependency-factory.ts`:**
   - Modify the `ServerContext` interface. Add `runtimeContext: RuntimeContext`.
   - Instead of having individual getter/setter closures for settings and state in `ServerContext`, pass `RuntimeContext` through `ServerContext`.
   - Remove these from `ServerContext`: `getSettings`, `getDashboardSettings`, `setDashboardSettings`, `getConsecutiveFailures`, `setConsecutiveFailures`, `updateLastStatus`, `getLastStatus`.
   - Replace them with `runtimeContext: RuntimeContext` in `ServerContext`.

3. **Update Dependency Factories:**
   - Modify `src/app/dependency-factory/core-factory.ts`, `src/app/dependency-factory/sprint-factory.ts`, `src/app/dependency-factory/mcp-factory.ts`, `src/app/dependency-factory/dashboard-factory.ts` to use `context.runtimeContext.getDashboardSettings()` and `context.runtimeContext.lastStatus` instead of the old closures.
   - Run `npx tsc --noEmit` to verify typecheck failures that will be fixed in the next step.

4. **Refactor `src/server/jules-agent-server.ts`:**
   - Add `runtimeContext: RuntimeContext` field to `JulesAgentServer`.
   - Initialize `this.runtimeContext = new DefaultRuntimeContext()`.
   - Remove `settings`, `dashboardSettings`, `consecutiveFailures`, `lastStatus`, `dashboardRuntimePort` fields from the server class.
   - Update `createContext()` to include `runtimeContext: this.runtimeContext` and remove the ad-hoc closures for these states.
   - Update all references to `this.settings`, `this.dashboardSettings`, `this.consecutiveFailures`, `this.lastStatus`, `this.dashboardRuntimePort` to use `this.runtimeContext` in `JulesAgentServer` methods (like `loadSettings`, `syncGitSettingsFromDashboard`, `getEffectiveJulesApiKey`, `getDashboardPort`, etc.).

5. **Verify changes:**
   - Run `npm run typecheck` to verify no type errors exist.

6. **Write tests:**
   - Create `tests/backend/runtime-context.test.ts`.
   - Write tests to verify that the getters and setters for `lastStatus`, `settings`, `dashboardSettings`, `consecutiveFailures`, and `dashboardRuntimePort` correctly update and retrieve state from `DefaultRuntimeContext`.

7. **Run tests:**
   - Run `npm run typecheck`
   - Run `npm run test -- tests/backend/smoke.test.ts`
   - Run `npm run test -- tests/backend/runtime-context.test.ts`

8. **Complete pre commit steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

9. **Submit task:**
   - Submit the completed task via `submit` tool to the feature branch.
