# Sprint 3: Test Coverage Hardening and Final Quality Push

- Sprint window: March 16, 2026 to March 20, 2026
- Sprint type: Quality and Stability
- Primary objective: Close the coverage gaps identified in the Sprint 2 CI failure to reach the 80% line coverage threshold across all modules.

## Backlog: 10 Atomic Tasks

### T01 - Add Unit Tests for `src/index.ts`
- Finding: `src/index.ts` has 0% coverage.
- Instructions: Extract the main logic from `src/index.ts` if necessary to make it testable, or use integration tests to cover the entry point. Focus on CLI argument parsing and server instantiation.
- Done criteria: `src/index.ts` coverage >= 80%.
- Dependencies: None.

### T02 - Improve Coverage for `src/app/dependency-factory/`
- Finding: `dashboard-factory.ts`, `mcp-factory.ts`, and `sprint-factory.ts` have low coverage (16-27%).
- Instructions: Add comprehensive unit tests for each factory module. Mock the dependencies and verify that the factories correctly wire and return the expected service instances.
- Done criteria: All files in `src/app/dependency-factory/` have >= 80% line coverage.
- Dependencies: None.

### T03 - Add Tests for Lifecycle Services
- Finding: `src/app/lifecycle/` has 0% coverage across dashboard, mcp, and settings services.
- Instructions: Create unit tests for `dashboard-lifecycle-service.ts`, `mcp-lifecycle-service.ts`, and `settings-lifecycle-service.ts`. Verify start/stop sequences and error handling.
- Done criteria: All files in `src/app/lifecycle/` have >= 80% line coverage.
- Dependencies: None.

### T04 - Harden Coverage for `src/infrastructure/providers/cli/`
- Finding: `docker-runner.ts` (1.58%) and `provider-runner.ts` (4.65%) have very low coverage.
- Instructions: Add unit tests for `DockerRunner` and `ProviderRunner`. Use mocks for the underlying command execution and verify the logic for container lifecycle, credential mounting, and prompt execution.
- Done criteria: `docker-runner.ts` and `provider-runner.ts` have >= 80% line coverage.
- Dependencies: None.

### T05 - Complete Coverage for `WorkspaceManager`
- Finding: `workspace-manager.ts` is at 20% coverage.
- Instructions: Expand the existing tests for `WorkspaceManager` to cover all public and private methods, including worktree preparation, removal, and path resolution for all execution modes.
- Done criteria: `workspace-manager.ts` has >= 80% line coverage.
- Dependencies: None.

### T06 - Add Tests for `ActivityCacheService`
- Finding: `activity-cache-service.ts` has 16.66% coverage.
- Instructions: Implement unit tests for `ActivityCacheService`. Verify cache insertion, retrieval, invalidation, and TTL logic.
- Done criteria: `activity-cache-service.ts` has >= 80% line coverage.
- Dependencies: None.

### T07 - Harden `JulesAgentServer` Coverage
- Finding: `jules-agent-server.ts` is at 41.34% coverage.
- Instructions: Expand the test suite for `JulesAgentServer` to cover the remaining orchestration logic, express routes, and error handling pathways that were missed.
- Done criteria: `jules-agent-server.ts` has >= 80% line coverage.
- Dependencies: None.

### T08 - Close Gaps in `CliWorkflowService` and `GitStatusService`
- Finding: `cli-workflow-service.ts` (53.65%) and `git-status-service.ts` (50.66%) still have significant gaps.
- Instructions: Add tests for the remaining logic in `CliWorkflowService` (task starting, resuming) and `GitStatusService` (remote status fetching, PR enrichment).
- Done criteria: Both services have >= 80% line coverage.
- Dependencies: None.

### T09 - Improve `ActionRequiredAutomation` and `BranchPreflightStep` Coverage
- Finding: `action-required-automation.ts` (67.34%) and `branch-preflight-step.ts` (28.57%) need more tests.
- Instructions: Add unit tests for the automation logic and the branch preflight check logic. Verify correct detection of blocked states and branch availability.
- Done criteria: Both modules have >= 80% line coverage.
- Dependencies: None.

### T10 - Final Coverage Stabilization and Threshold Enforcement
- Finding: Thresholds are currently blocking PR merge.
- Instructions: Perform a final sweep of any remaining uncovered lines across the project. Ensure `npm run test:coverage` passes locally with the 80% threshold.
- Done criteria: All coverage thresholds are met; CI passes without administrative override.
- Dependencies: T01-T09.
