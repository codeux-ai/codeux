# Postgres Migration Plan

## Context
Sprint OS currently uses SQLite for its runtime state. We are preparing to migrate to Postgres to support distributed deployments and richer operational tooling, but we must do so without causing a split-brain runtime or regressing local-first ease of use.

## Foundation Seams (Landed)
We have already landed the required persistence seams to make this migration possible:
- `DatabaseAdapter`: Abstract query execution, transaction wrapping, and connection management.
- `SqlDialect`: Abstract differences between SQLite and Postgres syntax (e.g., `jsonExtract`, `upsert`, `currentTimestamp`).
- Repositories now use `DatabaseAdapter` rather than raw SQLite bindings.

## Migration Phases

### Phase 1: Adapter and Dialect Rollout (Done)
- Replace direct `node:sqlite` usage with `DatabaseAdapter`.
- Migrate all raw SQL strings to use `SqlDialect` helpers for database-specific functions.

### Phase 2: Postgres Adapter Implementation
- Implement `PostgresDatabaseAdapter` conforming to the `DatabaseAdapter` interface.
- Implement `PostgresSqlDialect` implementing the specific Postgres syntax overrides.
- Refactor the connection lifecycle so Sprint OS can instantiate either the SQLite or Postgres adapter based on `AppConfig` or environment variables.

### Phase 3: Schema Management & Migrations
- Adapt `src/repositories/db/app-db-schema.ts` to support Postgres types (e.g., swapping `TEXT` for `JSONB` where appropriate, using Postgres `SERIAL` or `UUID`).
- Update `src/repositories/db/app-db-migrations.ts` to be dialect-aware, running the correct DDL for the chosen adapter.

### Phase 4: Runtime Integrity and Testing
- Run our extensive test suite against Postgres in CI.
- Resolve any remaining query-level differences or locking/concurrency differences between SQLite and Postgres.
- Implement a dual-write or shadow-read phase if necessary, though given our single-instance deployment model, a clean cutover via configuration is preferred.

### Phase 5: Rollout and Rollback
- The Postgres migration will be opt-in via configuration (`SPRINT_OS_DB_URL=postgres://...`).
- The default local-first experience will remain SQLite.
- **Rollout**: Users configure the Postgres connection string. On startup, the system detects Postgres, runs schema migrations via `PostgresDatabaseAdapter`, and starts the server.
- **Rollback**: To revert to SQLite, users unset the `SPRINT_OS_DB_URL` environment variable. The system will start using the local SQLite file.
- **Note**: Data migration (moving data from existing SQLite file to Postgres) will require a dedicated offline CLI script. This is explicitly out of scope for the runtime cutover to avoid runtime split-brain.

## Remaining Blockers
- The `PostgresDatabaseAdapter` implementation is pending.
- The `PostgresSqlDialect` implementation is pending.
- A robust CLI command for migrating existing SQLite data to Postgres is required before users with active projects can safely cut over.
