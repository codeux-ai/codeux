# ADR: Senior-Level Codebase Refactor Target Architecture

## Status
Proposed

## Context
The current codebase has grown organically, leading to several maintainability and modularity challenges. Key hotspots include overloaded services (e.g., `cli-workflow-service.ts`), monolithic orchestration logic, and duplicated configuration/settings logic across the backend and dashboard. 

To ensure long-term stability and enable parallel development, we are moving from monolithic services to a domain-oriented modular architecture. This document serves as the single source of truth for the target structure and migration strategy.

## High-Level Vision
Transition the codebase into a clean, layered architecture with clearly defined boundaries for Shared Utilities, Domain Logic, Infrastructure/Repositories, and API/Interface layers.

## Module Map (Target Architecture)

```text
src/
  app/
    runtime-context.ts          # Centralized application state
    dependency-factory.ts       # Composition root for all services
  shared/
    logging/                    # Structured logging and correlation IDs
    config/                     # Unified path resolution and value parsing
    polling/                    # Standardized wait/retry utilities
    subprocess/                 # Unified command execution layer
  domain/
    sprint/                     # Core sprint orchestration logic
      orchestrator/
      ci/                       # Isolated CI gate policies
    sessions/                   # Session sync and activity summarization
    settings/                   # Settings schema and validation
  infrastructure/
    repositories/               # Data persistence (File, SQLite)
    providers/
      cli/                      # Decomposed CLI/Docker runners
      jules/                    # Typed API client
  api/
    mcp/                        # MCP tool registry and handlers
    http/                       # Dashboard Express server and routes
```

## Migration Order
1. **Foundation (Shared/Infrastructure)**: Establish shared utilities (logging, config, subprocess) and repositories. This provides the base for all other modules.
2. **Domain**: Extract core business logic (sprint orchestration, CI gates, session management) into isolated, testable services.
3. **API/Services**: Refactor the top-level MCP and HTTP interfaces to use the new domain services and dependency factory.
4. **Dashboard**: Align the frontend with the unified settings and type contracts.

## Non-Goals
- **No Business Logic Changes**: The refactor focuses strictly on structural improvements and type safety. Existing behavior must be preserved.
- **No New Features**: No new product features should be introduced during the refactor window unless required for architectural integrity.
- **Partial Migration**: We aim for a complete transition of the identified hotspots; leaving "hybrid" states for core services is a non-goal.

## Constraints
- Must adhere to the technical standards defined in `GEMINI.md`.
- All new modules must have associated unit tests.
- Maintain compatibility with existing `.jules-subagents` file structures during the transition.

## Decision Drivers
- **Maintainability**: Reducing file sizes and cyclomatic complexity in core services.
- **Auditability**: Implementing structured logging and correlation IDs for better observability.
- **Type Safety**: Eliminating `any` usage at API and integration boundaries.
- **Parallelism**: Enabling multiple agents or developers to work on distinct modules without merge conflicts.
