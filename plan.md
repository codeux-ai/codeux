1. **Refactor `dashboard/src/v2/hooks/use-focus-trap.ts`:**
   - Modify the Tab logic to filter out disabled or dynamically removed elements properly, handle empty focusable lists, and safely trap focus within the modal.
   - Adjust the Escape handler to safely check if the active trap is handling the escape sequence without conflicting with nested handlers.
   - Make focus restoration resilient: When closing the trap, check `triggerRef.current?.isConnected` before calling `focus()` to prevent exceptions and ensure focus doesn't go to detached elements.
   - Remove global document listeners when the trap is inactive (the current logic already binds/unbinds on `active` state change).

2. **Consolidate Tests in `tests/dashboard/v2/use-focus-trap.test.tsx`:**
   - Implement tests for the tab-loop logic with missing/disabled elements.
   - Implement tests for checking focus leakage.
   - Implement tests for escape close deterministic behavior.
   - Implement tests for restoration checking connectivity.
   - Delete all temporary `.tsx` test files (`test-trap-edge-cases.tsx`, `test-trap-more-cases.tsx`, `test-trap-req.tsx`, `test-trap-escape.tsx`).

3. **Verify Consumers and Tests:**
   - Run `npm run test -- tests/dashboard/v2/use-focus-trap.test.tsx tests/dashboard/v2/add-project-modal.test.tsx`.
   - Ensure the hook keeps its current signature and `AddProjectModal` test passes, keeping the open autofocus behavior intact.

4. **Complete Pre-Commit Steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

5. **Submit:**
   - Commit and submit.
