1. **Refactor `ManagementToolHandler` to use a unified `formatError` function**:
   - Create a private helper function `formatError(domain: string, action: string, error: unknown): { content: Array<{ type: string; text: string }> }` inside `ManagementToolHandler`.
   - The function should check for `error instanceof Error` and extract the message, returning the stringified `ManagementResponseEnvelope` with `status: "error"`, `domain`, `action`, and `message`.
   - Update all `catch` blocks in `ManagementToolHandler` to use this new helper function.

2. **Enhance integration tests in `tests/backend/mcp/mcp-management.test.ts`**:
   - Write tests to verify the `ManagementToolHandler`'s error handling.
   - Specifically test that errors from dependencies (e.g., throwing a generic `Error` or string error) are correctly formatted and returned.
   - Verify that destructive actions (like `delete_project`, `delete_sprint`, `delete_task`) correctly return the `approvalRequired` envelope when approval is missing.
   - Verify that destructive actions execute when approval is provided.
   - Ensure the tests cover the full lifecycle of project, sprint, and task management via MCP tools (by mocking dependencies and asserting they are called).

3. **Complete Pre-Commit Steps**:
   - Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run test` to verify changes.
   - Ensure 100% pass rate.

4. **Submit changes**:
   - Create a commit and submit via tool.
