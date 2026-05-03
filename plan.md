1. **Define Error Classes in `repository-utils.ts`**
   - Create and export standard error classes: `RepositoryError` (extends `Error`), `EntityNotFoundError`, `ConcurrencyConflictError`, `ValidationError`.
   - Update `requireRecord` to throw `EntityNotFoundError`.

2. **Add Logger Dependency to Repositories**
   - Update `ProjectManagementRepository`, `ExecutionRepository`, and `MemoryRepository` to accept an optional `Logger` in their constructors (using `import type { Logger } from "../shared/logging/logger.js"` and `import { createLogger } from "../shared/logging/logger.js"`).
   - Initialize `this.logger = logger || createLogger({ bindings: { component: 'ProjectManagementRepository' } })` etc.

3. **Standardize Errors and Logging in `ProjectManagementRepository`**
   - Replace all instances of `throw new Error(...)` with the appropriate `EntityNotFoundError` or `ValidationError`.
   - In methods performing database operations (like `createProject`, `updateProject`, `deleteProject`, etc.), wrap the operation in a try/catch block.
   - Use `this.logger.error({ error, projectId, ... }, 'Operation failed')` in the catch block and rethrow the error as a `RepositoryError` or original error if it's already one.

4. **Standardize Errors and Logging in `ExecutionRepository`**
   - Replace `throw new Error(...)` with `EntityNotFoundError` or `ConcurrencyConflictError` (e.g. for "Lease already held").
   - Add try/catch blocks with `this.logger.error` for write operations, ensuring context (`projectId`, `sprintId`, `taskId`, etc.) is passed in the log metadata.

5. **Standardize Errors and Logging in `MemoryRepository`**
   - Ensure the `MemoryRepository` follows the same try/catch logging and error class pattern. Look for any `throw new Error(...)` and replace.
   - Add the `logger` injection and initialization.

6. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
