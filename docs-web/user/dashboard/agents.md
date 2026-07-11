# Agents

The **Agents** page (`/agents`) manages the **agent presets** available to the active project.

An *agent preset* is a reusable persona consisting of:

- A **name** and **avatar** (avatar config is auto-generated; you can re-roll it).
- A markdown **system instruction** that prepends every session this agent runs.
- An optional **memory template** — controls how project / sprint memory is injected into prompts.
- Optional persistent skill storage attachments, stored as shared project skill storage IDs for future retrieval.
- Optional MCP access, including default-off Code UX built-in tools and custom MCP server links.
- Optional runtime metadata such as provider/model preferences and a nullable Docker root-mode override for local CLI task runs.
- A set of **labels** for tagging and filtering.

Agent presets show up wherever a chat thread or planning request needs to choose an agent. SQLite is the live authority for these presets; markdown files are the project-local import/export copy used for review and sharing.

## Project name privacy

Agent instructions and examples should not publish real user/customer/live project names. Use generic
labels such as `live project`, `customer project`, `non-test project`, or `approved local test
project` when writing reusable instructions, screenshots, docs, or review notes.

## The showcase grid

Each preset is a card with avatar, name, label tags, and a one-line description. Click a card to open the **detail panel**.

## Avatar preview behavior

The 3D avatar preview uses lightweight WebGL presentation effects only. It relies on studio lighting, material finish, and avatar/tool animation rather than flashlight beams, target glows, or post-processing.

When motion is allowed, the avatar head can track pointer hover and runtime tool props animate beside the bot. Reduced-motion settings and WebGL fallback mode use the static SVG avatar instead, so the Agents page remains usable without animation or a WebGL context.

## Creating an agent

Click **+ New agent**. The form collects:

- **Name** — required, unique within the project.
- **System instructions (markdown)** — the persona prompt. This is *appended* to a base preface that ensures the agent knows it operates inside Code UX. You can also include reusable Instruction Files.
- **Memory template override** — checkbox. When enabled, you can write a custom template that controls how `<project_memory>` and `<sprint_memory>` blocks render via `Manage Memory`. Otherwise the project default is used.
- **Knowledge Base** — Subscribe the agent to documents from the shared library.
- **MCP Access** — Manage the agent's MCP tools access.
- **Labels** — comma-separated tags (e.g. `planner`, `reviewer`, `migrator`).
- **Avatar** — auto-generated (geometric/colour seed). You can customize it deeply using the avatar customizer.

Save creates the preset and broadcasts a real-time event so connected clients refresh.

## Editing an agent

Open the detail panel and click **Edit**. All fields are editable; saving creates a new revision (older revisions are discarded — agent presets are mutable, not versioned).

## Importing, pulling, and pushing markdown

Agent presets can be defined as markdown files inside `<repo>/.code-ux/agents/<preset_name>.md` with JSON frontmatter (the filename stem is normalized to become the preset's display name):

```markdown
---json
{
  "description": "Plans implementation work",
  "model": "gpt-5-codex"
}
---
You are a planner agent. Decompose user requests into ...
```

To import a single linked file into sqlite: open the agent detail panel and click **Import**.

To explicitly pull project markdown into sqlite, use **Pull from files** in the page header. The backend discovers `.code-ux/agents/*.md`, applies the existing project/default/home precedence rules, imports new files, and refreshes out-of-sync linked agents.

To explicitly push sqlite presets back to project files, use **Push to files** in the page header. Push writes only under the selected project’s `.code-ux/agents/` directory, exports manual, missing-source, out-of-sync, home-backed, and default-backed presets as project markdown overrides, and refuses to overwrite a file already linked to a different agent. Project markdown mirroring (`agents.saveToProjectDirectory`) must be enabled.

To push one sqlite preset to its project file, open the detail panel and click **Push to file**. This is useful when a single database-backed agent should become or refresh a repository-reviewed markdown file without exporting the whole roster.

Older API clients may still call the legacy `sync-markdown` endpoint as a backward-compatible alias for pull, but the current dashboard action is **Pull from files**.

This makes agent presets first-class repository content — you can check them in, code-review them, and share them across teammates.

## Deleting an agent

Destructive. Requires confirmation. Threads and tasks that referenced the deleted preset fall back to the project default agent.

## Instruction Files

Instruction files are separate markdown documents that act as reusable prompt components. You can manage them with the Instruction Files editor and include them inside agent instructions.

## Routing presets to invocation types

Where Code UX *uses* a preset is governed by the **invocation routing** settings (Settings → Routing). For each routing ID you can specify which provider config and (optionally) which agent preset is used:

- `task_coding` — coding work.
- `planning` — sprint planning.
- `dashboard_reply` — non-coding dashboard chat.
- `clarification_reply` — answering an agent's clarification request.
- `qa_review` — quality review pass.
- `ci_fix` — CI failure resolution.
- `merge_conflict` — merge conflict resolution.

A common pattern: have a "Planner" agent (Claude Opus, sober and structured) for `planning`, a "Coder" agent (Codex GPT-5) for `task_coding`, and a "Reviewer" agent for `qa_review`.

## Memory templates

When `memoryTemplateOverrideEnabled` is set, the preset's `memoryTemplateMarkdown` controls how project / sprint memories are formatted into prompts. The template uses simple `{{ }}` placeholders for memory blocks. See [Memory](./memory.md) for available placeholders.

## Docker root-mode override

Agent presets may store `containerRunAsRoot` as `true`, `false`, or `null`. The editor shows these as **Force root**, **Force non-root**, and **Inherit**. For local CLI task execution, the resolved worker preset's explicit boolean overrides the scoped Settings value `cliWorkflow.containerRunAsRoot`; `null` or an omitted field inherits that scoped setting. Root stays off by default, and the detail panel shows inherited posture as an inherited setting rather than implying root is enabled. Hosted Jules sessions ignore this preset field because they do not run in local Docker provider containers.

## Persistent skill storage

The dashboard can attach an agent to one or more named persistent skill storage records. These records live in dedicated skill tables and are separate from project workspaces, memories, knowledge documents, and provider model attachments.

Create and delete project skill storages in **Settings → Agents**, then attach them from either the settings attachment matrix or the agent editor. Persistent skill retrieval stays **off by default** for ordinary presets: an agent must have at least one storage attached and the explicit persistent skills toggle enabled before runtime retrieval can use it. The built-in Project Manager starts with one project-owned **Project Manager Skills** storage attached and enabled. Synchronization creates it only when that preset has no attachment, avoids duplicates, and preserves a later user opt-out.

On supported task coding, planning, QA and follow-up, CI repair, merge repair, remediation, dashboard reply, and clarification reply invocations, an opted-in agent with attached storage receives exactly one persistent-skill prompt context, retrieval limited to its project-scoped attachments, and isolated read-only storage mounts. Each storage is an internal Git repository committed through Code UX's containerized Git helper; the runtime prompt includes its revision and mutations go through `manage_skills`. Disabled agents, agents without attachments, cross-project preset mismatches, and invocations without a scoped agent receive no persistent-skill prompt context, retrieval grant, or mounts.

The agent detail and editor panels show attached storage names and whether persistent skills are **Default off** or **Enabled**. Hover, focus, click, or press Enter on an attached storage chip to lazily inspect its description, bounded skill count, names, tags, and short content previews. Activating the chip only inspects or retries the disclosure; the adjacent checkbox is the only control that attaches or detaches storage. The disclosure identifies loading, empty, retryable error, and truncated-preview states; detached storages are not inspected. Empty storage state means no persistent skills are available for that agent, and does not affect ordinary memory or knowledge subscriptions.

When the dashboard loads a storage's contents, it receives only a bounded set of concise skill summaries and short content previews. The disclosure shows at most four skills, three tags per skill, and 180 preview characters. Full markdown bodies and runtime filesystem or mount paths are not exposed by this project-scoped endpoint, so opening the Agents page never triggers a full-body storage fetch.

Persistent skills remain separate from memory templates, knowledge document subscriptions, and MCP access. The narrow `search_skills` retrieval grant can be available to an opted-in agent without enabling the broader Code UX MCP management tools described below.

## MCP access

Agent MCP access is default-deny. If a preset has no saved MCP access record, Code UX built-in tools display as disabled and the agent does not inherit broad project-manager tool access. Custom MCP server links, such as Playwright, are controlled separately and can remain linked without enabling Code UX built-in tools.

The **Connected MCPs** editor panel opens a risk-gated manager for Code UX tools. Turning on Code UX for the dashboard reply agent enables the built-in MCP surface plus the restricted `scheduler_code_ux` tool and the dedicated `add_long_term_memory` lane. Turning on Code UX for other agents keeps `scheduler_code_ux` explicitly disabled by default while broader tools remain visible for review.

Scheduler access lets an agent create its own wakeups through the secured agent scheduler surface. It does not grant full scheduler administration, due-entry execution, recurrence editing, sprint scheduling, task reruns, or destructive scheduler actions.

The dashboard reply route defaults to Project manager and always receives the full built-in Code UX MCP surface, scheduler, direct long-term-memory lane, and the default Playwright MCP server for dashboard chat turns. This is keyed to the dashboard reply route assignment rather than the generic project-manager role. When persisted Code UX access is off but this runtime grant applies, the agent detail/editor surfaces show `Code UX · Runtime` so the visible connection matches actual dispatch behavior. Enabling scheduler or any other Code UX tool for planning, coding, QA, CI repair, merge-conflict, or other non-chat agents is riskier because those agents run during operational workflows and can affect project state without being part of a direct dashboard chat exchange.
