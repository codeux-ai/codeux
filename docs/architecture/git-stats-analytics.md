# Git Stats Analytics

This document covers the architectural model and behavioral flow for the Git analytics surfaced within the project Stats page. This system enables developers to answer programmatic metrics about their orchestration outputs (insertions, deletions, files modified, and PR confirmations).

## Persisted Git Metric Sources

The primary source of truth for programmatic Git metrics is the `task_run_events` table. We do not try to run dynamic `git log` commands across the repository at query time, because tasks could be running concurrently, checked out in different workspaces, or even reset over time.

Instead, when an automated tool (e.g. Jules, Codex) or a CLI agent pushes code or opens a PR, a specific event with a payload is recorded on the active task run:

- `git_metrics`
- `cli_git_pushed`
- `jules_git_pushed`

These payloads carry the `numstat` delta metrics (generated from `git diff --numstat`), which are now aggregated efficiently using SQL `GROUP BY` logic and SQLite JSON functions rather than in-memory application-level loops. A custom backend parser correctly handles standard files (reporting specific insertion and deletion line counts) and binary files (which output `-` for insertion/deletion counts, treated safely without causing numeric blowups).

We track pull requests and merge confirmations via orchestration checkpoints:
- **PR Count**: Determined via the presence of a non-null `pr_url` on `task_runs`.
- **Merged Count**: Calculated using the `is_merged` boolean flag from the `tasks` table.

## Snapshot Contract Fields

When the frontend queries for Git analytics, the payload returned from `GET /api/projects/:projectId/stats?window=...` includes the Git dimensions nested within the stats snapshot. These fields roll up dynamically based on the requested date window (`24h`, `7d`, `30d`, `all time`, or custom):

- `totalInsertions`: Sum of all line insertions parsed from matched task run events.
- `totalDeletions`: Sum of all line deletions.
- `totalFilesChanged`: Number of distinct files touched across these events.
- `pullRequests`: Number of distinct PRs created in the current scope.
- `pullRequestsMerged`: Number of those PRs that ultimately landed (`is_merged = true`).
- `perAuthor` (or analogous breakdown): A split aggregating which provider (or virtual worker vs human intervention) originated the metrics.

## Dashboard Git Tab Behavior

The dashboard incorporates these fields directly into a dedicated **Git** tab on the Stats page (`/stats`).

- It sits alongside the **Tokens** and **Time** tabs.
- Changing the time window (e.g., from `7d` to `30d`) re-fetches the underlying snapshot and updates the Git metrics dynamically.
- The UI surfaces these as high-level summary cards (Insertions, Deletions, Files Changed) and visualizes the commit/PR success flow (PRs Opened vs PRs Merged).
- Because it shares the `useProjectStats` hook and data model with the token telemetry, realtime updates and fallback polling automatically keep the Git analytics tab fresh as new `task_run_events` are inserted into SQLite.
