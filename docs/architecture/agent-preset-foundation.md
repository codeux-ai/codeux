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
- `persistent_skill_storage_enabled` reserves a default-off runtime enablement flag for future persistent skill retrieval
- `created_at`
- `updated_at`

Persistent agent skill storage is modeled separately from memories, knowledge documents, project workspaces, and model attachments:

- `skill_storages` stores named, project-owned storage containers for reusable agent skills.
- `skills` stores individual skill records under a storage container, with content metadata and source identity.
- `skill_embeddings` stores embedding metadata and optional embedding blobs for skill search.
- `agent_skill_storage_bindings` attaches agent presets to one or more storage containers through a normalized `(agent_preset_id, storage_id)` binding.

The shared preset contract exposes `persistentSkillStorageIds?: string[]` plus optional `persistentSkillStorage` enablement metadata. The repository round-trips those IDs through `agent_skill_storage_bindings`; it does not use a workspace path field for skill attachment state. Backend persistence, markdown import/export, and vector retrieval are implemented by `SkillRepository`, `SkillMarkdownParser`, and `SkillService`. Runtime mounting, provider prompt injection, MCP tools, and dashboard controls are intentionally not implemented in this slice.

Skill records are project-bound at every access point. `SkillRepository` validates the owning project for storages, skills, agent attachments, embedding loads, and deletes. Deleting a storage explicitly removes agent bindings, skill embeddings, and skill rows before deleting the container, matching the cascade contract even in tests or adapters where foreign-key behavior is not the only guardrail.

Skill markdown is stored in the database rather than in project worktrees. Frontmatter fields (`title`, `description`, `tags`, `appliesTo`, `version`) become skill metadata, while the markdown body remains the authoritative instruction content. `skill_embeddings` stores model id, dimension, chunk index, content hash, and vector blob so retrieval can skip stale or dimension-mismatched rows after model changes.

The current markdown-sync and Planning agent extensions are documented in:

- [Agent Sync And Planning Agent](./agent-sync-and-planning-agent.md)

Implementation files:

- `src/contracts/agent-preset-types.ts`
- `src/contracts/skill-types.ts`
- `src/repositories/agent-preset-repository.ts`
- `src/repositories/skill-repository.ts`
- `src/services/skill-markdown-parser.ts`
- `src/services/skill-service.ts`
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
- optional persistent skill storage attachments (backend persistence and retrieval only; no dashboard controls or runtime prompt injection yet)

The memory injection configuration is stored in sqlite as `memory_config_json` and parsed back into `AgentMemoryConfig` on reads, matching the existing JSON-column pattern used by `mcp_access_json`.
The dashboard editor now initializes that config from the preset, exposes it through a dedicated `Manage Memory` popover, and persists the chosen filters alongside the rest of the preset payload.

Agent labels are still stored in the data model for markdown sync and built-in preset conventions, but the dashboard no longer exposes custom label editing. The Agents page displays computed route-assignment tags from effective project settings instead, including tags for built-in fallback selections on Planning agent, Worker, Project manager, and Quality assurance agent.

Built-in Worker and Project manager presets seed `mcp_access_json` with `code_ux` enabled and the default `playwright` custom MCP server linked. Planning and QA presets do not receive that link by default. Existing agents with a user-edited MCP access payload keep their selections; only newly imported/generated defaults or previously unconfigured built-in Worker/Project manager records receive the seeded link.

## Dashboard Interaction Contract

Agent configuration surfaces expose state directly in the UI without changing the preset API contract or avatar schema:

- Preset saves, creates, imports, deletes, sync operations, memory filter edits, MCP access changes, instruction file saves, and avatar edits use persistent status regions for pending, saved, failed, retry, disabled, and unsaved states.
- Required preset fields and instruction file content validate on blur and submit. Submit attempts mark fields as touched, show helper or error copy, and focus the first invalid field.
- Selected agents, instruction files, memory categories, MCP tools, and avatar parts include visible `Selected`, `Enabled`, `Disabled`, or equivalent labels so state is not communicated by color or avatar animation alone.
- Selection movement uses the dashboard `selectionMovement` interaction token, while reduced-motion users still get static labels and badges.
- Destructive or discard-style actions ask for confirmation and restore focus to the invoking control when the user cancels.

## Avatar Rendering Performance

Agent preset avatars have two rendering tiers:

- `AgentAvatarSvg` is the lightweight static renderer for preset cards, reduced-motion users, and loading fallbacks.
- `AgentAvatarScene` is the high-fidelity Three.js renderer for large avatar stages after they are visible.

`LazyAgentAvatarScene` is the required boundary for dashboard surfaces that want the 3D avatar. It renders the SVG fallback until an `IntersectionObserver` reports the stage visible, and it keeps reduced-motion users on the static SVG path so ordinary Agents page interactions do not import or initialize the heavy scene. Surfaces that need immediate rendering can opt in explicitly with the wrapper's `eager` prop.

The 3D scene owns WebGL lifecycle cleanup. On unmount, fallback transition, WebGL failure, or reduced-motion changes, it cancels animation frames, removes event listeners, disposes avatar geometries, materials, textures, particle resources, and the renderer, and forces context loss when supported.

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
- `quality_assurance_agent.md` -> `Quality assurance agent`
- `project_setup_agent.md` -> `Project Setup Agent`

`Project manager` is now used by worker-routed clarification auto-answer. That prompt injects the preset's markdown, includes sprint context, and passes through the latest explicit Jules clarification message when recent session activities contain one.

## Why This Matters

This change removes one of the major architecture mismatches in the v2 refactor.

It means the system now has a clean distinction between:

- product configuration
- runtime connections
- execution workers

That separation is required before more planning and worker orchestration logic can be added safely.
