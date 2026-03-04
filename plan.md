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
