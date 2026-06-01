---
name: Debug "validate-all-fields" validation failures
description: When a test fails with a confusing validation error, dump the full validation result to find unrelated payload issues that fail before the target logic
source: auto-skill
extracted_at: '2026-05-31T23:20:16.611Z'
---

# Debugging multi-field validation failures

When a validation function checks **all fields** upfront (like `validateSettingsPayload`), a single test that only focuses on one field can fail on **unrelated fields first**. The first issue in the result array is misleading — it's not the field under test.

## Symptoms
- Test assertion like `expect(result.issues[0].message).toContain("Expected text")` fails with `"Expected an object"` instead
- The error message does not match what the test is trying to assert
- Multiple unrelated tests fail with the same first-issue error

## Procedure

1. **Run the failing test and dump the full validation result.** Don't just check `result.issues[0]` — capture ALL issues.

2. **Find the canonical reference payload.** Look for `DEFAULT_*_SETTINGS` or `createDefault*` functions in the codebase that represent a known-valid payload structure.

3. **Cross-reference each validation error against the defaults.** For each unexpected issue path:
   - Check if the field exists in the default payload
   - Check if the value type matches what validation expects
   - Check if the value is in the allowed enum/set (`GUARDRAIL_ON_LIMIT_ACTIONS`, `INVOCATION_ROUTING_IDS`, `VIRTUAL_WORKER_PROVIDERS`, `GUARDRAIL_JOB_TYPES`, etc.)

4. **Fix the test payload.** Either:
   - Replace the inline payload with a factory function that returns a fresh copy
   - Base the payload structure on the project's `DEFAULT_*_SETTINGS` constant
   - Ensure all enums and required keys are up-to-date with the current validation schema

5. **Verify.** Run tests for both the fixed field AND the field under test to confirm all pass.

## Key insight
When `validateSettingsPayload` returns `issues[0] = { path: "someOtherField", message: "Expected an object" }`, the issue is NOT in the `sprintBranchScheme` logic — it's that an earlier validation gate (`isRecord(value)` check) rejected the parent object entirely. Always read the **full issue list** before chasing the first error.