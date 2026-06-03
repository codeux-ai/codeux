# Agent Preset Foundation

## Status
Implemented foundation, later extended with markdown sync and Planning agent orchestration

## Purpose

Code UX now separates `Agents` from live MCP connections.

`Agents` are project-scoped instruction presets, not runtime clients.

This is the first product-correct slice for the v2 `Agents` page.

## Data Model

Agent presets are stored in sqlite table:

- `agent_presets`

Foundation fields:

- `id`
- `project_id`
- `name`
- `description`
- `instruction_markdown`
- `labels_json`
- `provider_config_id`
- `model`
- `memory_config_json` stores `AgentMemoryConfig` as a JSON blob
- `created_at`
- `updated_at`

The current markdown-sync and Planning agent extensions are documented in:

- [Agent Sync And Planning Agent](./agent-sync-and-planning-agent.md)

Implementation files:

- `src/contracts/agent-preset-types.ts`
- `src/repositories/agent-preset-repository.ts`
- `src/server/dashboard-server.ts`

## API Surface

Dashboard endpoints:

- `GET /api/projects/:projectId/agent-presets`
- `POST /api/projects/:projectId/agent-presets`
- `PATCH /api/agent-presets/:agentPresetId`
- `DELETE /api/agent-presets/:agentPresetId`

These endpoints are project-scoped and intentionally separate from:

- live MCP connection APIs
- chat thread APIs
- worker dispatch APIs

## Dashboard Behavior

The v2 `Agents` page now manages project-scoped presets only.

Foundation-supported fields:

- preset name
- short routing description
- instruction markdown
- optional provider instance preference
- optional model override
- optional per-agent memory injection configuration

The memory injection configuration is stored in sqlite as `memory_config_json` and parsed back into `AgentMemoryConfig` on reads, matching the existing JSON-column pattern used by `mcp_access_json`.

Agent labels are still stored in the data model for markdown sync and built-in preset conventions, but the dashboard no longer exposes custom label editing. The Agents page displays computed route-assignment tags from effective project settings instead, including tags for built-in fallback selections on Planning agent, Worker, Project manager, and Quality assurance agent.

Provider and model preferences are intentionally nullable. They only take effect when a provider invocation route uses the `AGENT` strategy; otherwise the agent inherits the configured route, worker, or global defaults.

At runtime, the CLI workflow now reads `AgentMemoryConfig` from the resolved worker agent and post-filters injected memories by configured tier, categories, strength thresholds, and max counts before composing the prompt. When the config is absent, the workflow keeps the default unrestricted memory injection path.

This foundation gave Code UX a clean product base for:

- reusable planning roles
- reusable worker role definitions later
- reusable project-manager clarification guidance
- future task-to-agent assignment

## What This Fixes

Before this change, the `Agents` page incorrectly showed:

- live listeners
- workers
- connection heartbeat state

That mixed runtime transport state with a product concept that should be stable and reusable.

The page now aligns with the intended model:

- `Agents` = presets
- live connections stay in runtime/chat/live surfaces

## What Is Not Included Yet

This is only the foundation slice.

Not implemented yet:

- automatic task assignment to presets
- preset-to-worker matching
- preset inheritance or global templates
- preset versioning
- preset execution analytics

## Current Built-In Conventions

Code UX currently recognizes these markdown-backed preset conventions under `.code-ux/agents`:

- `planning_agent.md` -> `Planning agent`
- `worker.md` -> `Worker`
- `project_manager.md` -> `Project manager`

`Project manager` is now used by worker-routed clarification auto-answer. That prompt injects the preset's markdown, includes sprint context, and passes through the latest explicit Jules clarification message when recent session activities contain one.

## Why This Matters

This change removes one of the major architecture mismatches in the v2 refactor.

It means the system now has a clean distinction between:

- product configuration
- runtime connections
- execution workers

That separation is required before more planning and worker orchestration logic can be added safely.
