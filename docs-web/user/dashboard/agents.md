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

Agent presets show up wherever a chat thread or planning request needs to choose an agent.

## Project name privacy

Agent instructions and examples should not publish real user/customer/live project names. Use generic
labels such as `live project`, `customer project`, `non-test project`, or `approved local test
project` when writing reusable instructions, screenshots, docs, or review notes.

## The showcase grid

Each preset is a card with avatar, name, label tags, and a one-line description. Click a card to open the **detail panel**.

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

## Importing / syncing from markdown

Agent presets can be defined as markdown files inside `<repo>/.code-ux/agents/<preset_name>.md` with YAML frontmatter (the filename stem is normalized to become the preset's display name):

```markdown
---
name: Planner
labels: [planner]
---
You are a planner agent. Decompose user requests into ...
```

To import a single file: open the agent detail panel and click **Import markdown**.

To bulk-sync all agent files in `.code-ux/agents/`: click **Sync from markdown** in the page header. Conflicts (a markdown file that matches an existing agent by name) prompt for resolution.

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

Create and delete project skill storages in **Settings → Agents**, then attach them from either the settings attachment matrix or the agent editor. Persistent skill retrieval stays **off by default**: an agent must have at least one storage attached and the explicit persistent skills toggle enabled before runtime retrieval can use it.

The agent detail panel shows attached storage names and whether persistent skills are enabled. Empty storage state means no persistent skills are available for that agent; it does not affect ordinary memory or knowledge subscriptions.

## MCP access

Agent MCP access is default-deny. If a preset has no saved MCP access record, Code UX built-in tools display as disabled and the agent does not inherit broad project-manager tool access. Custom MCP server links, such as Playwright, are controlled separately and can remain linked without enabling Code UX built-in tools.

The **Connected MCPs** editor panel opens a risk-gated manager for Code UX tools. Turning on Code UX starts with **scheduler-only** access: only the restricted `scheduler` tool is enabled, while broader tools such as `manage_scheduler`, `manage_tasks`, `manage_sprints`, and settings or memory management stay disabled until you explicitly enable them.

Scheduler-only access lets an agent create its own wakeups or task reruns through the secured agent scheduler surface. It does not grant full scheduler administration, due-entry execution, recurrence editing, sprint scheduling, or destructive scheduler actions.

The dashboard reply route is the safe default use case for scheduler-only access because it supports chat replies that need to schedule follow-up wakeups. Enabling scheduler or any other Code UX tool for planning, coding, QA, CI repair, merge-conflict, or other non-chat agents is riskier because those agents run during operational workflows and can affect project state without being part of a direct dashboard chat exchange.
