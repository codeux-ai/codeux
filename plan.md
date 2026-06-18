1. **Analyze Requirements:**
   - Extract logic from `QualityAssuranceService` into a pure function `buildQaReviewRequest` inside `src/domain/qa-review/qa-review-request-builder.ts`.
   - The logic to extract includes:
     - `resolveTaskTriggerType`
     - Sprint feature branch fallback logic
     - Memory instruction composition (`resolveAgentMemoryInstructions`)
     - Agent instructions building
     - Review run payload construction (`triggerType`, agent settings, instructions).
   - Keep repository mutations, side effects (workspace, Git, providers) in `QualityAssuranceService`.
   - Update `tests/backend/services/quality-assurance-service.test.ts` to use mock builder if needed, but mostly update to reflect the change.
   - Create unit tests for the builder in `tests/backend/domain/qa-review/qa-review-request-builder.test.ts`.
   - Update `docs/architecture/quality-assurance-agent.md` to reflect the pure builder.

2. **Implement `qa-review-request-builder.ts`:**
   - Define interfaces `QaReviewRequestBuilderArgs` and `QaReviewRequest`.
   - Move `resolveTaskTriggerType` logic into this file.
   - Compose agent instructions with memory logic.
   - Determine sprint feature branch logic.
   - Determine target agent preset based on trigger type.

3. **Update `quality-assurance-service.ts`:**
   - Import `buildQaReviewRequest` from `qa-review-request-builder.ts`.
   - Refactor `reviewCompletedTask` to use `buildQaReviewRequest`.
   - Remove `resolveTaskTriggerType` from `quality-assurance-service.ts`.

4. **Add Unit Tests:**
   - Create `qa-review-request-builder.test.ts` covering disabled QA, different triggers, missing project/sprint, memory instruction composition.
   - Update `quality-assurance-service.test.ts`.

5. **Update Architecture Docs:**
   - Modify `docs/architecture/quality-assurance-agent.md` to explain `qa-review-request-builder`.

6. **Pre-commit Checks:**
   - Run Vitest, typecheck, pre_commit_instructions.

7. **Submit.**
