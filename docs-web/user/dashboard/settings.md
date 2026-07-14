# Settings

The **Settings** page (`/config`) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.

## The scope hierarchy

Settings are evaluated as a cascade:

```
Defaults → System → Project → Sprint
```

You can edit at any level. Higher levels override lower ones; unspecified fields inherit. The side panel always shows the **effective** (merged) value.

Switch scope with the selector at the top:

- **System** — applies to all projects.
- **Project** — applies to the active project.
- **Sprint** — applies to the selected sprint within the active project.

The sticky command/status bar keeps the System/Project selector, project availability or inheritance context, active panel, and the Reset Project / Save Changes actions visible together while you scroll. Smart Find stays compact by showing only the search field until you type; active searches then show result status and match-preview chips while the exact category total remains available to assistive technology.

On desktop, categories stay visible in the left rail and the active settings content starts at the top of the right workspace. Labels and linked controls within a setting row also align from the top when either side wraps onto multiple lines. On smaller screens, the command bar shows one compact current-category button instead of the full rail. Open it to use the same Smart Find-filtered category list and match previews in a drawer. Arrow keys move between categories, Enter or Space selects one, and Escape closes the drawer and restores focus to the category button.

The last selected **System** or **Project** scope is remembered in the local database as part of system runtime settings. Changing only that selector is saved immediately and does not save unrelated draft edits in the active settings form.

## Categories

The desktop rail and mobile category drawer include these Expert-mode categories:

| Category | What it covers |
| --- | --- |
| **General** | Scope context, experience mode, automation posture, runtime logging, Docker runtime, restart behavior, onboarding, and System legal actions. |
| **Appearance** | Theme, accessible accent preset, navigation mode, motion preference, background, and desktop zoom. |
| **AI Models** | Language-first local speech setup, downloadable embedding/STT/TTS catalogs, API speech settings, provider anchors, routing, model choices, thinking mode, weighting, and pricing. |
| **Sprint & Git** | Git flow, PR behavior, merge gates, QA, guardrails, branch naming, and execution runtime controls. |
| **Browser Preview** | Preview runtime, in-app browser visibility, container limits, port allocation, and startup scripts. |
| **Techstacks** | System catalog management, protected built-in stack, project stack assignment, and web/desktop application kind. |
| **Guidance** | Tech stack guidance, styleguides, custom worker instructions, and header selector defaults. |
| **Agents** | Agent routing, markdown mirroring, persistent skill storage, storage attachments, and self-reflection criteria. |
| **Memory** | Embedding model selection, memory capture, promotion, and remediation policy. |
| **Integrations** | Provider credentials, Git hosts, Jira, project-linked storage mounts, and read-only PM/canvas importers. |
| **MCP** | MCP servers injected into provider CLIs and built-in tool access. |
| **Danger Zone** | Project override reset, project deletion, memory clearing, and database reset. |

Each category opens one or more **content panels** with grouped fields. Inputs are typed (text, number with min/max, toggle, multi-select) and validate inline.

### Language-first speech output

Open **AI Models -> Configure speech** and choose the output language first. Code UX preselects the catalog's preferred compatible local model and a matching voice. The recommendation keeps **Selected**, **Installed / Download required**, and **Output enabled / off** visible as separate states; the normal **Save Changes** action still controls when the draft becomes active.

No model downloads automatically. **Download recommended** opens the named model's license and attribution confirmation, and only **Accept & Download** starts the transfer. **Compare compatible models** opens Speech output filtered to the chosen language, with the preferred model first and alternatives still available.

## General legal actions

In System scope, the General category includes a legal-actions card alongside its runtime and setup controls:

- **License** opens the canonical Code UX [LICENSE](https://github.com/codeux-ai/codeux/blob/main/LICENSE) file in an external destination.
- **OS Software** opens a searchable, informational catalog of the open-source dependencies distributed with Code UX. Each catalog entry provides a license identifier and a link to the dependency's project.

The OS Software catalog is a static reference. It does not participate in Settings drafts, **Save Changes**, project overrides, or settings persistence.

## Experience modes

Experience mode is controlled from **Settings -> General** with three user-facing choices:

- **Easy** — shows the essentials: General, Appearance, Integrations, and Danger Zone. Primary navigation shows Chat, Browser Preview, Stats, Live, Settings/Config, and Docs.
- **Standard** — the balanced project-operation surface: General, Appearance, AI Models, Sprint & Git, Browser Preview, Techstacks, Agents, Memory, Integrations, and Danger Zone. Primary navigation shows Chat, Overview, Sprints, Tasks, Agents, Stats, Browser Preview, Docs, and Settings/Config.
- **Expert** — shows all settings categories and advanced cards, and is the default for new or legacy settings.

Changing mode filters what is visible. It does not delete hidden values, mutate project overrides, or save anything until you use the normal Save action.

## Agents settings

The **Agents** category is a modular surface for project markdown mirroring, agent routing, persistent skill storage, storage attachments, and self-reflection controls.

- Project Markdown Mirror starts with a compact status summary, then the mirror toggle and `.code-ux/agents` target directory. The status summary makes it clear whether dashboard-authored project agents are mirrored to repository-visible markdown or kept database-backed only.
- Agent Routing is split into a routing-mode choice, an orchestrator roster, and role-specific preset selectors. Manual mode pins coding to one preset or the built-in Worker fallback. Orchestrator mode gives the Planning agent a multi-select roster of project specialists; the selected-count summary stays visible, long agent names wrap, and an empty roster explains that project agents must be created first.
- Role selectors for planning, coding, CI fix, merge conflict, dashboard reply, and clarification reply always keep the built-in fallback available. When custom project agents are unavailable, disabled selectors explain that you must select a project before choosing project presets.
- Persistent skill storage is project-scoped and separate from memory. A compact summary opens a dedicated storage manager for creating, renaming, describing, and deleting records; those actions save immediately and do not use the Settings draft or global **Save Changes** action.
- The manager reports whether each storage has skill content, while making clear that storage does not enable runtime retrieval by itself. Per-agent attachments and retrieval toggles remain in the main Agents settings panel.
- The per-agent attachment matrix is separate from storage management. Each agent shows attached storage choices, a visible **Default off** or **Enabled** state, and an explanation when retrieval cannot be enabled yet. Retrieval is off by default and removing the last attachment forces it off. Attachment and retrieval-toggle changes update the agent preset immediately rather than waiting for **Save Changes**. Loading, empty, project-only, and error states remain visible without hiding the other Agents settings groups.
- The four Agents groups stack for narrow screens and form a wider card workspace when room is available, so markdown mirroring, routing, storage, and reflection can be scanned independently.
- Storage deletion is destructive and requires typing the exact storage name because it removes stored skills, embeddings, and agent attachments.
- Planning and QA self-reflection are disabled by default. Each loop has an enable toggle, editable criteria rows, per-criterion thresholds, and a max improvement attempts setting.
- QA self-reflection also appears in the existing Quality Assurance settings area so review criteria can be edited alongside QA routing and review budgets.
- Agent routing and planning/QA self-reflection fields retain the normal Settings draft behavior: they are not persisted until **Save Changes** is used. Immediate storage and attachment mutations do not save or discard those draft fields.

## Saving & resetting

Each scope has a **Save** button at the panel footer that persists changes and broadcasts a real-time event so other connected clients refresh.

A **Reset to defaults** button at scope level removes all overrides for that scope (system reset is destructive and requires confirmation).

## Effective settings preview

A side panel shows the *effective* settings for the current scope — i.e. after merging defaults / system / project / sprint. Useful when overriding an obscure field and you want to confirm the final value.

You can also fetch effective settings programmatically:

- `GET /api/projects/:projectId/settings/effective`
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`

## External settings hints

The **AI providers** category includes a **Detected** column. Code UX inspects:

- `JULES_API_KEY` / `JULES_KEY` env vars.
- `~/.gemini/`, `~/.codex/`, `~/.claude/`, `~/.qwen/`, `~/.local/share/opencode/` for installed-CLI auth.
- `GITHUB_TOKEN` / `GH_TOKEN` env vars and `gh auth status`.

If a hint is detected, the panel offers a one-click **Use detected value** button so you don't paste secrets manually.

## Google Drive mount

Settings > Integrations includes Google Drive under **Storage & Mounts**. It links an already synced local Google Drive directory; Code UX does not request or store Google credentials. The linked directory follows the normal System → Project settings cascade and is saved only with the scoped Settings draft.

The mount is available to scoped Docker-backed provider workspaces at the fixed `/mnt/code-ux/google-drive` container path. It is shared by Project Manager replies, planning, setup, task coding, QA, CI repair, and merge repair; host-mode and unscoped runs do not receive it. **Read-only** is the safe default. Choose **Read-write** only when agents must modify synced Drive files, because edits and deletions can propagate through Google Drive. A card is **Configured** only after a linked directory is set and **Active** only when that configured mount is also enabled. The host path appears only inside the editable linked-directory control.

## Provider config files

Each CLI provider instance in **AI providers** includes a **Provider Config** choice that controls only provider config-file copying. It is separate from API Key, Local Copy, and Dashboard Login authentication modes.

| Choice | Use it when |
| --- | --- |
| **None** | You do not want Code UX to copy a provider config file into the runtime. |
| **Copy Host** | You want Docker runs to copy the provider's normal host config path, shown read-only in the card. Examples include Codex `~/.codex/config.toml`, Gemini `~/.gemini/settings.json`, Claude Code `~/.claude.json`, Qwen Code `~/.qwen/settings.json`, OpenCode `~/.config/opencode/opencode.json`, and Antigravity `~/.gemini/antigravity-cli/mcp_config.json`. |
| **File** | You want to select a specific config file with the local file picker, such as an alternate Codex `config.toml` or OpenCode `opencode.json`. |

Jules and the internal test provider do not use provider config files. Switching Provider Config choices does not clear API keys, auth paths, custom endpoints, or dashboard-login credentials.

### Dashboard Login terminal

Dashboard Login opens the provider's real interactive CLI in the managed container. Each CLI starts as the normal non-root runtime user from a dedicated empty `/tmp/code-ux-login` directory instead of `/`, preventing discovery-oriented tools such as Qwen Code from warning about or scanning the container root. Credential storage and the read-only provider-tool volume are unchanged.

The terminal interprets ANSI cursor and erase controls while removing non-display OSC/DCS strings such as Qwen window-title and terminal-color queries. Full-screen redraws stay within a bounded 100-column by 30-row layout, meaningful prompts and authentication links remain selectable, and output uses high-contrast white text. Click the console to focus it. Right-click exposes Paste without transferring focus away from the session, while Ctrl+V and Command+V continue to work normally. Arrow keys, Tab, Escape, Backspace, Ctrl+C, and Ctrl+D are sent directly to the provider CLI. Clipboard success or denial appears below the console instead of failing silently.

## Connections panel

A separate **Connections** panel lists active MCP client connections to this project — display name, role, transport, capabilities, last activity. From here you can rename connections or set the *preferred worker* for the project.

## Danger zone

The **Danger zone** category groups the destructive, irreversible actions. Each is gated behind a confirmation dialog.

- **Delete project** — permanently removes the selected project and all of its tasks, sprints, memories, and context history.
- **Project memory** (shown when a project is selected) — clears that project's stored memory by tier:
  - *Short-term* — per-sprint, per-agent working memories only (long-term knowledge is kept).
  - *Long-term* — promoted project memories plus all memory claims and evidence (short-term is kept).
  - *All memory* — the project's entire memory database (every memory, claim, and evidence record).
- **System memory** (System scope) — the same three tiers, but applied across **every** project at once.
- **Reset database** (System scope) — wipes all Code UX state (projects, sprints, tasks, memories, runs) and returns to a clean install.

Clearing memory removes the stored vectors along with the rows; downloaded embedding models are left untouched. All of these actions are **irreversible**.

For the full schema, see [Settings reference](../../developer/settings-reference.md).

## Settings Reference

The dashboard Settings page links each card header to a dedicated Settings reference page. Use the [Settings docs hub](../../settings/index.md) for the full map, or jump directly to a specific area such as [System Runtime](../../settings/system-runtime.md), [Provider Credentials](../../settings/provider-credentials.md), [Route Mapping](../../settings/route-mapping.md), or [Danger Zone](../../settings/danger-zone.md).

For the complete JSON schema and API-level field names, see [Settings reference](../../developer/settings-reference.md).
