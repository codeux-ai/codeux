# ADR: Sprint 2 Gap Closure and Migration Contract

## Status
Accepted

## Context
Sprint 1 established the foundation for the domain-oriented modular architecture, transitioning key utilities and defining the target structure in [Refactor Target Architecture](./refactor-target-architecture.md). However, several core hotspots remain partially refactored, and technical debt (specifically `any` types and duplicated logic) persists in the integration layers.

Sprint 2 is dedicated to closing these gaps, ensuring the system reaches a "Jules-Ready" state of high reliability and strict type safety before any further feature expansion.

## Scope: Sprint 2 Focus Areas
- **Hotspot Decomposition**: Finalize the extraction of `cli-workflow-service.ts` into domain-specific modules (`src/domain/sprint/`, `src/domain/sessions/`).
- **Type Safety Enforcement**: Eliminate `any` usage in all touched files and define strict interfaces for internal service-to-service communication.
- **Persistence Consolidation**: Ensure all state-changing operations go through standardized repositories in `src/infrastructure/repositories/`.
- **Policy Logic Centralization**: Remove duplicated orchestration and CI gate logic, moving it into the `src/domain/sprint/` sub-modules.

## Target Boundaries
- **Domain Layer**: Must contain 100% of the business logic. No shell command execution or direct file system access is permitted here.
- **Infrastructure Layer**: Handles all external side effects (Git, Docker, File System). Must be hidden behind interfaces defined in the domain or app layer.
- **App Layer**: Responsible for dependency injection and application lifecycle via `dependency-factory.ts`.

## Migration Rules & Acceptance Criteria
For every PR in Sprint 2, the following rules are mandatory:

1.  **No `any` Policy**: Any file touched during a task must have all `any` types replaced with explicit, documented interfaces or types.
2.  **Test Parity**: Existing tests must be migrated to the new structure. New logic must have >90% unit test coverage.
3.  **Single Persistence Path**: No direct `fs` calls for settings or session state. Use the `SettingsRepository` or `SessionTrackingRepository`.
4.  **No Sync Shell Calls**: Transition any remaining synchronous shell execution on hot paths to the unified `subprocess` utility in `src/shared/subprocess/`.
5.  **Auditability**: Every critical decision point in the orchestrator must emit a structured log with a correlation ID.

## Sequencing Constraints
- **Foundation First**: Repository and Shared utility updates must precede Domain logic refactors.
- **Contract Freeze**: Interface definitions in `src/contracts/` must be finalized before implementing the corresponding service logic.

## Non-Goals
- **Product Features**: No new user-facing features or MCP tools.
- **Performance Optimization**: Unless a refactor significantly degrades performance, optimization is secondary to structural integrity.
- **UI Redesign**: The dashboard should only be updated to maintain compatibility with backend API changes.

## Decision Drivers
- **Reliability**: Reducing "hidden" failures by enforcing strict types and centralized error handling.
- **Scalability**: Enabling independent testing of domain logic without requiring a full Docker/Git environment.
- **Maintainability**: Ensuring the codebase follows a predictable, layered pattern that is easy for new agents to navigate.
