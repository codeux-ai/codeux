
1. Use the `run_in_bash_session` tool to run a Node.js script `patch_utils_fix.cjs` that reads `src/server/preview-host-utils.ts` and fixes the `requestBufferedPreviewResponse` function so that when the 5MB body size limit is exceeded, it destroys the stream and explicitly rejects the Promise.
2. Use the `run_in_bash_session` tool with `git diff` to verify that `src/server/preview-host-utils.ts` was updated successfully.
3. Use the `run_in_bash_session` tool to run a Node.js script `patch_service_fix.cjs` that modifies `src/services/sprint-preview-service.ts` to enforce the 5MB body size limit *during* the stream read by utilizing the `response.body` (which is a `ReadableStream`) or the Node.js stream, instead of waiting for `await response.arrayBuffer()` to buffer the whole payload.
4. Use the `run_in_bash_session` tool with `git diff` to verify that `src/services/sprint-preview-service.ts` was updated successfully.
5. Use the `run_in_bash_session` tool to run a Node.js script `patch_tests_fix.cjs` to append test cases for `set-cookie` suppression and bridge injection to `tests/backend/services/sprint-preview-service-unit.test.ts` and `tests/backend/server/preview-host-utils.test.ts`.
6. Use the `run_in_bash_session` tool with `git diff` to verify the modifications.
7. Use the `run_in_bash_session` tool to run tests via `pnpm run test:backend -- tests/backend/services/sprint-preview-service-unit.test.ts tests/backend/server/preview-host-utils.test.ts tests/backend/services/sprint-preview-docker-plan.test.ts` to ensure functionality is fully working.
8. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
9. Use the `submit` tool to finish the task.
