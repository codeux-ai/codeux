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
- `container_run_as_root` stores a nullable per-agent Docker root-mode override; `NULL` inherits the resolved `cliWorkflow.containerRunAsRoot` setting
- `memory_config_json` stores `AgentMemoryConfig` as a JSON blob
- `persistent_skill_storage_enabled` reserves a default-off runtime enablement flag for future persistent skill retrieval
- `created_at`
- `updated_at`

Persistent agent skill storage is modeled separately from memories, knowledge documents, project workspaces, and model attachments:

- `skill_storages` stores named, project-owned storage containers for reusable agent skills.
- `skills` stores individual skill records under a storage container, with content metadata and source identity.
- `skill_embeddings` stores embedding metadata and optional embedding blobs for skill search.
- `agent_skill_storage_bindings` attaches agent presets to one or more storage containers through a normalized `(agent_preset_id, storage_id)` binding.

The shared preset contract exposes `persistentSkillStorageIds?: string[]` plus optional `persistentSkillStorage` enablement metadata. The repository round-trips those IDs through `agent_skill_storage_bindings`; it does not use a workspace path field for skill attachment state. Backend persistence, markdown import/export, and vector retrieval are implemented through `SkillRepository`, `SkillMarkdownParser`, and `SkillService`. `persistent-skill-context.ts` is the shared invocation boundary that verifies agent ownership and opt-in state, resolves attached mounts, and idempotently composes prompt guidance before either the canonical provider executor or direct worker-reply runner applies MCP policy. Dashboard controls are intentionally separate from the storage contract.

Skill records are project-bound at every access point. `SkillRepository` validates the owning project for storages, skills, agent attachments, embedding loads, and deletes. Deleting a storage explicitly removes agent bindings, skill embeddings, and skill rows before deleting the container, matching the cascade contract even in tests or adapters where foreign-key behavior is not the only guardrail.

Skill markdown is stored in the database rather than in project worktrees. Frontmatter fields (`title`, `description`, `tags`, `appliesTo`, `version`) become skill metadata, while the markdown body remains the authoritative instruction content. `skill_embeddings` stores model id, dimension, chunk index, content hash, and vector blob so retrieval can skip stale or dimension-mismatched rows after model changes.

Persistent skill storage remains disabled by default. At runtime, Code UX resolves persistent skill storage only when all of these are true:

- the invoked provider call is associated with an agent preset id
- that agent has `persistentSkillStorage.enabled === true`
- the agent has at least one enabled `agent_skill_storage_bindings` row
- the storage belongs to the same project as the invocation

When enabled, the provider prompt receives one additional `PERSISTENT SKILL STORAGE` section after the existing task, memory, and learning-capture content. The section tells the agent to search existing skills first with `search_skills` using the current `projectId` and `agentPresetId`, lists the attached writable storage paths, and explains that newly authored durable skills should be saved through MCP write APIs when available or as markdown under the mounted persistent path when MCP write access is not available. Composition is idempotent, so retries and resumed prompts retain a single section. Direct dashboard and clarification replies persist this composed user prompt in their execution invocation records.

The mounted filesystem paths are derived by Code UX, not by user settings. Host execution receives paths under `~/.code-ux/persistent-skill-storages/<project-id>/<agent-id>/<storage-id>/`. Docker execution bind-mounts those directories read/write under `/code-ux/persistent-skills/<storage-id>/`. Both roots are outside the project workspace (`/workspace` in Docker and repository worktrees on host), so persistent skills do not become uncommitted project files and workspace cleanup does not delete them.

Dashboard storage management remains project-scoped. Storage updates require both the project ID and storage ID, and the storage contents endpoint verifies the same ownership pair before returning data. Contents responses include storage metadata and at most 100 concise skill summaries; markdown is reduced to a whitespace-normalized preview of at most 240 characters, and full skill bodies, filesystem paths, and host mount locations are never included.

Provider MCP access is similarly scoped. Skill-enabled agents are eligible for the retrieval-only `search_skills` surface even when their broader Code UX management surface is disabled. This does not automatically grant unrelated management tools such as task, sprint, settings, or full skill-management mutation APIs. The end-to-end regression coverage in `tests/backend/integration/persistent-skills-runtime.test.ts` verifies that shared attached storage is visible to both attached agents through MCP search, stays hidden from unattached agents, and produces provider prompt and mount metadata only for enabled attached agents.

The current markdown-sync and Planning agent extensions are documented in:

- [MCP Tools and Contracts](../mcp/tools-and-contracts.md#search_skills-retrieval-tool)
- [Agents Design System](../dashboard/design-system-agents.md#persistent-skills)
- [Agent Sync And Planning Agent](./agent-sync-and-planning-agent.md)

Implementation files:

- `src/contracts/agent-preset-types.ts`
- `src/contracts/skill-types.ts`
- `src/repositories/agent-preset-repository.ts`
- `src/repositories/skill-repository.ts`
- `src/services/skill-markdown-parser.ts`
- `src/services/skill-service.ts`
- `src/services/provider-execution-service.ts`
- `src/services/agent-mcp-access.ts`
- `src/infrastructure/providers/cli/provider-runner.ts`
- `src/infrastructure/providers/cli/workspace-manager.ts`
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
- optional persistent skill storage attachments (default-off, isolated from project workspaces, and injected only for enabled attached agents at provider runtime)

The memory injection configuration is stored in sqlite as `memory_config_json` and parsed back into `AgentMemoryConfig` on reads, matching the existing JSON-column pattern used by `mcp_access_json`.
The dashboard editor now initializes that config from the preset, exposes it through a dedicated `Manage Memory` popover, and persists the chosen filters alongside the rest of the preset payload.

Agent labels are still stored in the data model for markdown sync and built-in preset conventions, but the dashboard no longer exposes custom label editing. The Agents page displays computed route-assignment tags from effective project settings instead, including tags for built-in fallback selections on Planning agent, Worker, Project manager, and Quality assurance agent.

Agent MCP access is default-deny for built-in Code UX tools. Absent, malformed, or previously unconfigured agent access resolves with `codeUxEnabled: false`, so provider runs do not inherit management tools from the system-level MCP settings merely because they are agent-scoped.

Built-in Worker and Project manager presets seed `mcp_access_json` with the default `playwright` custom MCP server linked, but `code_ux` remains disabled in that seeded access. Planning and QA presets do not receive that link by default. Existing agents with a user-edited MCP access payload keep their selections; only newly imported/generated defaults or previously unconfigured built-in Worker/Project manager records receive the seeded custom-server-only link.

Dashboard chat replies are the only default exception. The route defaults to the built-in `Project manager`. Each assigned dashboard reply agent receives the full built-in Code UX MCP surface, the restricted `scheduler_code_ux` self-wakeup tool, the dedicated `add_long_term_memory` direct-write lane, and the default Playwright MCP server by default, even when the selected reply preset has Code UX disabled or no saved MCP policy. Runtime dispatch preserves the selected agent's linked custom MCP servers, adds the Playwright link once, and sends the assigned agent id through the built-in `code_ux` connection, allowing the MCP router to apply the dashboard-reply full-access default. An explicitly narrowed dashboard-reply policy still has `scheduler_code_ux` and `add_long_term_memory` forced on. Planning, coding, CI fix, merge-conflict, clarification, QA, generated setup, and general Project manager agent runs remain denied unless their preset explicitly enables Code UX tools; when Code UX is first enabled for those non-dashboard agents, `scheduler_code_ux` is explicitly off by default.

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

The Docker root-mode preference is also nullable. For local CLI task execution, the resolved worker preset may set `containerRunAsRoot` to `true` or `false` to override the scoped `cliWorkflow.containerRunAsRoot` value for that run. The dashboard agent editor presents this as Inherit (`null`), Force non-root (`false`), and Force root (`true`), and the detail panel reports the configured posture without treating inheritance as enabled root. Hosted Jules sessions do not use this field because they do not run in local Docker provider containers.

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
