1. **Create Standardized Errors**:
   - Create `src/shared/errors/standard-errors.ts` and `src/shared/errors/index.ts`.
   - Define error base class `StandardError`.
   - Define subclasses: `TerminalError`, `TransientError`, `ResourceExhaustedError`, etc.
   - Include metadata (code, retryable flag).

2. **Update `ProviderExecutionService`**:
   - Update `src/services/provider-execution-service.ts` to wrap thrown errors in `TransientError` or `TerminalError` depending on classification (e.g. `ProviderQuotaError` or using `classifyProviderError` and `resolveProviderRetryDecision`).
   - Use the `metadata` property to add the original stack trace when wrapping errors.
   - Do not obscure original errors.
   - Ensure the updated service correctly captures `projectId`, `taskId`, and `correlationId` using the context logger child and error wrapping.

3. **Standardize Logging**:
   - Update `src/shared/logging/logger.ts` to accept the new Standard Errors.
   - When formatting `Error` metadata in `normalizeMetadataValue` in `logger.ts`, handle the new StandardErrors properly (e.g. `code`, `retryable`, `metadata` fields) without exposing internal secrets. Add explicit `projectId`, `taskId`, `correlationId` if present.

4. **Add Error Boundaries to Background Loops**:
   - Update `src/domain/sprint/orchestrator/watch-loop-runner.ts` and `src/services/virtual-worker-service.ts` to catch `StandardError`.
   - Distinguish between `TerminalError` (crash/exit the loop for the run) and `TransientError` (log warning, backoff, but don't crash).
   - Ensure they log the error properly instead of exiting the entire loop or crashing.

5. **Pre-commit Steps**:
   - Run technical quality gates to ensure proper testing, verification, review, and reflection are done.

6. **Submit**:
   - Commit and submit.
