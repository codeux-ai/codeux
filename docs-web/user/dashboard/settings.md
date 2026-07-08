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

The last selected **System** or **Project** scope is remembered in the local database as part of system runtime settings. Changing only that selector is saved immediately and does not save unrelated draft edits in the active settings form.

## Categories

The category rail on the left includes these Expert-mode categories:

| Category | What it covers |
| --- | --- |
| **General** | Scope context, experience mode, automation posture, runtime logging, Docker runtime, restart behavior, and onboarding. |
| **Appearance** | Theme, navigation mode, motion preference, background, and desktop zoom. |
| **AI Models** | Default provider anchors, provider routing, model choices, thinking mode, weighting, pricing, and rate-limit controls. |
| **Sprint & Git** | Git flow, PR behavior, merge gates, QA, guardrails, branch naming, and execution runtime controls. |
| **Browser Preview** | Preview runtime, in-app browser visibility, container limits, port allocation, and startup scripts. |
| **Techstacks** | System catalog management, protected built-in stack, project stack assignment, and web/desktop application kind. |
| **Guidance** | Tech stack guidance, styleguides, custom worker instructions, and header selector defaults. |
| **Agents** | Agent routing, markdown mirroring, persistent skill storage, storage attachments, and self-reflection criteria. |
| **Memory** | Embedding model selection, memory capture, promotion, and remediation policy. |
| **Integrations** | Provider credentials, Git hosts, Jira, and read-only PM/canvas importers. |
| **MCP** | MCP servers injected into provider CLIs and built-in tool access. |
| **Danger Zone** | Project override reset, project deletion, memory clearing, and database reset. |

Each category opens one or more **content panels** with grouped fields. Inputs are typed (text, number with min/max, toggle, multi-select) and validate inline.

## Experience modes

Experience mode is controlled from **Settings -> General** with three user-facing choices:

- **Easy** — shows the essentials: General, Appearance, Integrations, and Danger Zone. Primary navigation shows Chat, Browser Preview, Stats, Live, Settings/Config, and Docs.
- **Standard** — the balanced project-operation surface: General, Appearance, AI Models, Sprint & Git, Browser Preview, Techstacks, Agents, Memory, Integrations, and Danger Zone. Primary navigation shows Chat, Overview, Sprints, Tasks, Agents, Stats, Browser Preview, Docs, and Settings/Config.
- **Expert** — shows all settings categories and advanced cards, and is the default for new or legacy settings.

Changing mode filters what is visible. It does not delete hidden values, mutate project overrides, or save anything until you use the normal Save action.

## Agents settings

The **Agents** category includes project markdown mirroring, agent routing, persistent skill storage, and self-reflection controls.

- Project Markdown Mirror starts with a compact status summary, then the mirror toggle and `.code-ux/agents` target directory. The status summary makes it clear whether dashboard-authored project agents are mirrored to repository-visible markdown or kept database-backed only.
- Agent Routing is split into a routing-mode choice, an orchestrator roster, and role-specific preset selectors. Manual mode pins coding to one preset or the built-in Worker fallback. Orchestrator mode gives the Planning agent a multi-select roster of project specialists; the selected-count summary stays visible, long agent names wrap, and an empty roster explains that project agents must be created first.
- Role selectors for planning, coding, CI fix, merge conflict, dashboard reply, and clarification reply always keep the built-in fallback available. When custom project agents are unavailable, disabled selectors explain that you must select a project before choosing project presets.
- Persistent skill storage is project-scoped and separate from memory. Creating a storage does not enable runtime retrieval. Attach one or more storages to an agent, then enable persistent skills for that agent.
- Storage deletion is destructive and requires confirmation because it removes stored skills, embeddings, and agent attachments.
- Planning and QA self-reflection are disabled by default. Each loop has an enable toggle, editable criteria rows, per-criterion thresholds, and a max improvement attempts setting.
- QA self-reflection also appears in the existing Quality Assurance settings area so review criteria can be edited alongside QA routing and review budgets.

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

## Provider config files

Each CLI provider instance in **AI providers** includes a **Provider Config** choice that controls only provider config-file copying. It is separate from API Key, Local Copy, and Dashboard Login authentication modes.

| Choice | Use it when |
| --- | --- |
| **None** | You do not want Code UX to copy a provider config file into the runtime. |
| **Copy Host** | You want Docker runs to copy the provider's normal host config path, shown read-only in the card. Examples include Codex `~/.codex/config.toml`, Gemini `~/.gemini/settings.json`, Claude Code `~/.claude.json`, Qwen Code `~/.qwen/settings.json`, OpenCode `~/.config/opencode/opencode.json`, and Antigravity `~/.gemini/antigravity-cli/mcp_config.json`. |
| **File** | You want to select a specific config file with the local file picker, such as an alternate Codex `config.toml` or OpenCode `opencode.json`. |

Jules and the internal test provider do not use provider config files. Switching Provider Config choices does not clear API keys, auth paths, custom endpoints, or dashboard-login credentials.

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

## Settings Subcategory Reference

Each Settings subcategory card includes an info control with the same guidance summarized here and a documentation control that opens the exact section below.

### Project Context

<a id="project-context"></a>

Names and identifies the active project without changing the stored project id or execution history.

**What it controls:** Project name is editable; project id, source type, and base directory explain how Code UX addresses and enters the workspace.

**Recommended defaults:** Use a clear project name and keep the base directory aligned with the repository root workers should use.

**Risks and gotchas:** Renaming is cosmetic, but an unexpected base directory usually means the project was created from the wrong path.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Dashboard Guide](./overview.md)

### Automation

<a id="automation"></a>

Controls how much Code UX may continue without pausing for operator decisions.

**What it controls:** Automation level sets the broad approval posture; auto-approve plans and auto-resume paused runs handle routine continuation points.

**Recommended defaults:** Use Semi-auto for normal work, Full only for trusted projects, and Always ask for sensitive repositories.

**Risks and gotchas:** More automation can move faster but may continue through a bad plan or stale context before you intervene.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Security Hardening](../troubleshooting.md)

### Docker Runtime

<a id="docker-runtime"></a>

Defines the default container environment used by Docker-backed provider CLIs.

**What it controls:** Image, setup script, memory limit, setup image caching, root execution posture, and Playwright browser preinstall shape each worker container.

**Recommended defaults:** Keep the default image unless your repo needs a custom toolchain; keep `cliWorkflow.containerRunAsRoot` off unless a trusted tool requires package-manager or OS-level writes; enable Playwright preinstall for browser-heavy QA.

`cliWorkflow.containerRunAsRoot` defaults to `false` and inherits through the settings cascade. Project overrides inherit the system value until changed. Agent presets can override only local Docker-backed CLI task runs with nullable `containerRunAsRoot`: **Inherit** stores `null`, **Force non-root** stores `false`, and **Force root** stores `true`. Root mode is privileged and is not a safety boundary for untrusted code.

With setup-image caching enabled, Playwright preinstall is baked into the derived image at `/ms-playwright` and reused by later non-root provider runs without rerunning the browser download. Cache-disabled workflows and custom setup scripts must opt into this by honoring `CODE_UX_INSTALL_PLAYWRIGHT=1` and installing Chromium in the setup script when browser automation is required.

**Risks and gotchas:** Broken setup scripts or overly tight memory limits can fail every provider invocation in the scope. Root mode changes the Docker user posture for provider containers in that scope, though an agent preset can still force non-root or force root for a specific local CLI worker.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Security Hardening](../troubleshooting.md)

### System Runtime

<a id="system-runtime"></a>

Configures dashboard port and runtime logging behavior for the local Code UX process.

**What it controls:** Dashboard port controls the HTTP listener; console and debug-file levels control log verbosity.

**Recommended defaults:** Keep port 4444 and info/error logging for daily use; raise verbosity only while debugging.

**Risks and gotchas:** Changing the port requires reconnecting clients, and debug logging may write large local files.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Logging and Correlation IDs](../troubleshooting.md)

### Restart Behavior

<a id="restart-behavior"></a>

Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts.

**What it controls:** Sprint policy continues, pauses, or cancels active sprints; invocation policy continues, cancels, or restarts interrupted work.

**Recommended defaults:** Continue sprints and continue invocations for local development; pause when you want manual review after downtime.

**Risks and gotchas:** Restarting interrupted work can duplicate provider effort if the previous CLI run was still externally active.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Atomic Sprint Loop](../sprint-orchestration.md)

### Database Settings

<a id="database-settings"></a>

Manages local SQLite retention and maintenance for runtime activity data.

**What it controls:** Pruning removes old completed activity, retention sets the age window, and vacuum compacts storage on startup.

**Recommended defaults:** Keep pruning and vacuum enabled unless you are preserving local forensic history.

**Risks and gotchas:** Short retention can remove useful troubleshooting detail; disabling pruning can grow the local DB quickly.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Operations Runbook](../troubleshooting.md)

### Onboarding

<a id="onboarding"></a>

Reopens the guided setup flow without changing saved settings by itself.

**What it controls:** The action button launches onboarding so you can revisit Easy, Standard, or Expert setup, provider configuration, GitHub workflow choices, and Appearance prompts. Easy keeps GitHub deselected until the operator opts in. Appearance choices preview immediately while onboarding is open, including Theme, Navigation Mode, Reduced Motion, Background Mode, Static Color, and supported Zoom Level.

**Recommended defaults:** Use Easy for the shortest single-provider path with Dashboard Login, Standard for guided regular setup, and Expert when you need every runtime and routing control. Expert remains the default.

**Risks and gotchas:** Reopening onboarding does not change settings by itself. Finishing the flow saves the selected choices through the normal system settings path; Easy applies default settings only after explicit completion and redirects to Chat.

Related docs:

- [Onboarding settings](../../settings/subcategories/onboarding.md)
- [Quickstart](../installation.md)

### Display Settings

<a id="display-settings"></a>

Controls the dashboard shell layout, theme, motion preference, and desktop zoom when available.

**What it controls:** Navigation Mode switches dock/sidebar, Theme sets Light, Dark, or System color mode, Reduced Motion limits animation, and Zoom Level scales Electron windows. Experience mode is controlled from Settings -> General and filters primary dock/sidebar navigation without changing these display preferences.

**Recommended defaults:** Use System theme and Auto reduced motion unless you need a fixed accessibility preference.

**Risks and gotchas:** Browser navigation still depends on sprint preview and in-app browser visibility settings. High zoom or dense sidebars can reduce visible workspace on small screens.

Related docs:

- [Dashboard Accessibility Patterns](./overview.md)
- [Mobile Responsiveness](./overview.md)

### Background

<a id="background"></a>

Customizes the dashboard background image, animation mode, static color, and pattern overlay.

**What it controls:** Background Image, Background Mode, Animation Style, Static Color, and Pattern Overlay shape the visual layer behind panels. Onboarding previews Theme, Navigation Mode, Reduced Motion, Background Mode, Static Color, and supported Zoom Level while it is open, while Animation Style, Pattern Overlay, and custom background image remain available here after onboarding.

**Recommended defaults:** Prefer lightweight images and readable contrast; use static mode if motion is distracting.

**Risks and gotchas:** Large images and busy patterns can hurt performance or reduce text contrast.

Related docs:

- [Dashboard Design System](./settings.md)
- [Mobile Responsiveness](./overview.md)

### Default Routing Anchors

<a id="default-routing-anchors"></a>

Sets the global and worker provider instances used when invocation routes inherit defaults.

**What it controls:** Global and worker defaults choose named provider instances and base models; concurrency and timeout cap worker dispatch.

**Recommended defaults:** Pick stable, authenticated instances for both anchors before fine-tuning route overrides.

**Risks and gotchas:** Unconfigured anchors leave inherited routes without a usable provider.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [Configuration and Storage](../../developer/settings-reference.md)

### Base Provider Configuration

<a id="base-provider-configuration"></a>

Defines each named provider instance's default eligibility, model, thinking depth, weight, and concurrency.

**What it controls:** Provider cards set default route participation, model, thinking mode, weighted routing weight, and max concurrent tasks.

**Recommended defaults:** Keep only healthy instances eligible and use weights to express preference rather than hard pinning every route.

**Risks and gotchas:** Incompatible model choices or high concurrency can cause repeated provider failures or quota pressure.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [Qwen Code Integration](../providers-and-models.md)
- [OpenCode Integration](../providers-and-models.md)

### Route Mapping

<a id="route-mapping"></a>

Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.

**What it controls:** Each route chooses a profile, strategy, primary instance, allowed weighted pool, and per-provider overrides. Thinking overrides can be reset to inherit the provider instance's base thinking setting.

**Recommended defaults:** Use inherited defaults first, then override high-risk routes such as planning, QA, CI repair, and remediation.

**Risks and gotchas:** Weighted pools with unavailable providers can spread failures across multiple task types. Stale route thinking overrides can keep using an older thinking budget until reset to inherit.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [Atomic Sprint Loop](../sprint-orchestration.md)

### Model Pricing

<a id="model-pricing"></a>

Stores token pricing metadata used for model cost estimates in dashboard views.

**What it controls:** Pricing rows define per-model input and output token costs where the dashboard can estimate usage.

**Recommended defaults:** Keep prices current for providers you actively route to and leave unknown models unset.

**Risks and gotchas:** Outdated prices affect estimates only; they do not change provider billing.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [Dashboard Guide](./overview.md)

### Git Flow

<a id="git-flow"></a>

Controls branch naming, task PR title naming, PR creation, issue closure, and cleanup for sprint work.

**What it controls:** Git mode, default branch, prefixes, sprint key, branch template, task PR title template, PR toggles, linked issue closure, and branch deletion define the workflow. The Task PR title scheme is saved as `git.taskPrTitleScheme`, defaults to `({sprint_tag}) {task_title}`, and accepts `{sprint_tag}`, `{sprint_key}`, `{sprint_number}`, `{sprint_title}`, `{task_key}`, `{task_title}`, and `{provider}`. `{sprint_tag}` uses the first linked issue key when present, otherwise `<sprintKeyPrefix>-<sprint number>`, then a stable sprint slug/id fallback. Provider text appears only when the template includes `{provider}`.

**Recommended defaults:** Use Remote mode for PR/CI automation and Local mode for repositories where Code UX must not touch remotes.

**Risks and gotchas:** Wrong default branches can disrupt expected repository flow, and overly terse task PR title schemes can make automated pull requests harder to scan.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Instruction Template System](../sprint-orchestration.md)

### Merge Gates & Autofix

<a id="merge-gates-autofix"></a>

Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges.

**What it controls:** Comment resolution, conflict repair, CI repair, feature PR auto-merge, and main PR auto-merge shape merge readiness.

**Recommended defaults:** Require green checks and resolved comments for shared branches; use immediate auto-merge only in low-risk repositories.

**Risks and gotchas:** Relaxed merge gates can land incomplete work; Local mode disables remote PR gates by design.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Security Hardening](../troubleshooting.md)

### Quality Assurance

<a id="quality-assurance"></a>

Controls completion-time QA review, QA routing, and trigger-specific agent assignment.

**What it controls:** QA toggles, max-run budgets, exhaustion policy, and trigger selectors decide when and how final reviews run. Each trigger uses one row with an enable switch and custom QA agent multi-select; leaving the selector empty uses the built-in QA fallback.

**Recommended defaults:** Keep QA enabled for multi-task sprints and route it to a provider with strong review behavior.

**Risks and gotchas:** Disabling QA removes an important last check before merge automation continues. Project-specific QA agent selectors stay disabled until a project is selected, but the built-in QA fallback remains active.

Related docs:

- [Quality Assurance Agent](../sprint-orchestration.md)
- [Provider Routing](../providers-and-models.md)

### Guardrails

<a id="guardrails"></a>

Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably.

**What it controls:** Per-job caps and on-limit actions determine whether Code UX blocks, waits, warns, or continues.

**Recommended defaults:** Keep guardrails enabled and use block-and-escalate for expensive or destructive job types.

**Risks and gotchas:** Very high caps can burn provider quota; very low caps can stop recoverable work too early.

Related docs:

- [Quality Guardrails](../sprint-orchestration.md)
- [Operations Runbook](../troubleshooting.md)

### Rate Limit

<a id="rate-limit"></a>

Controls retries after provider quota or rate-limit responses.

**What it controls:** Quota reset waits, fixed retry delays, retry counts, and no-timer quota retry caps define retry behavior.

**Recommended defaults:** Retry on concrete quota reset timers and keep fixed retries modest.

**Risks and gotchas:** Aggressive retries can keep failing tasks occupied and delay operator escalation.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Provider Routing](../providers-and-models.md)

### Watch Loop

<a id="watch-loop"></a>

Controls whether live sprint orchestration keeps polling and how frequently it emits work.

**What it controls:** The watch-loop toggle, evaluation interval, and output interval drive recurring orchestration checks.

**Recommended defaults:** Keep the loop enabled with moderate intervals for active sprints.

**Risks and gotchas:** Very short intervals can add noise; disabling the loop means progress depends on manual or external triggers.

Related docs:

- [Atomic Sprint Loop](../sprint-orchestration.md)
- [Operations Runbook](../troubleshooting.md)

### Workspace Hygiene

<a id="workspace-hygiene"></a>

Controls cleanup of temporary worktree state after provider CLI runs.

**What it controls:** Success and failure cleanup toggles decide whether Code UX removes temporary execution workspace state.

**Recommended defaults:** Clean successful worktrees and keep failed worktrees only when you are actively debugging.

**Risks and gotchas:** Keeping failed worktrees can consume disk; removing them can erase useful repro artifacts.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Security Hardening](../troubleshooting.md)

### Workspace Visibility

<a id="workspace-visibility"></a>

Controls automatic preview lifecycle and whether browser workspace entry points appear in the dashboard.

**What it controls:** Preview enablement, in-app browser visibility, auto-start, rebuild triggers, and auto-stop define the preview lifecycle.

**Recommended defaults:** Enable previews for UI projects and stop terminal previews automatically to conserve local resources.

**Risks and gotchas:** Automatic rebuilds can be noisy for slow projects or heavy Docker images.

Related docs:

- [Browser Preview](./browser-preview.md)
- [Sprint Preview Browser](./browser-preview.md)

### Runtime Limits

<a id="runtime-limits"></a>

Sets preview container concurrency, host port range, app port, and startup script path.

**What it controls:** Container cap, host port start/end, internal app port, and startup override path decide how previews launch.

**Recommended defaults:** Keep preview ports on localhost-only ranges and set the app port to the project dev server port.

**Risks and gotchas:** Port collisions or wrong startup scripts prevent previews from becoming reachable.

Related docs:

- [Browser Preview](./browser-preview.md)
- [Security Hardening](../troubleshooting.md)

### Techstacks

<a id="techstacks"></a>

Manages the system techstack catalog and per-project techstack/application-kind assignment.

**What it controls:** System scope owns stack ids, stack names, technology items, and the catalog default. Project scope stores only the selected stack id and application kind, with explicit `Unassigned` support.

**Recommended defaults:** Keep imported projects unassigned until setup detection or an operator chooses a stack. Use the built-in Code UX Stack only for Code UX-style Preact dashboards; create custom stacks for other project families.

**Risks and gotchas:** The built-in `code-ux-internal` stack cannot be removed. Removing a custom stack also clears system-default references to it; project assignments should be reviewed before deleting stacks that are in active use.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Settings Reference](../../developer/settings-reference.md)

### Guidance

<a id="guidance"></a>

Manages active tech-stack guidance, active styleguide guidance, and custom instruction entries for the current scope.

**What it controls:** System scope edits default design guidance; project scope edits the active project override. Each section has a selector with `None`, a custom-entry list, and add/edit/delete controls for custom entries. Built-in entries are selectable but protected.

The top navigation shows the active project's effective tech stack guidance and styleguide selectors beside global search. Header selections save the project override immediately. **Add Tech Stack**, **Add Styleguide**, and **Manage Guidance** in the dropdown footers all open the Guidance settings area for custom entries and visibility controls.

**Recommended defaults:** Keep both selections at `None` until a project needs explicit guidance beyond its repository instructions. Add custom entries for stable team or product guidance that should be reused.

**Risks and gotchas:** `hideDefaultStyleguides` hides built-in styleguides from the dashboard selector while preserving `None`, custom styleguides, and the saved selected id. Deleting a selected custom entry clears that selection back to `None`. Design guidance also feeds the Planning and Project Setup prompts, which resolve selected entries from effective project settings. `None` catalog entries are not injected, but Project Setup still includes a setup-only styling investigation notice whenever the styleguide selection is `None`.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Settings Reference](../../developer/settings-reference.md)
- [Styleguides and Tech Stacks](./styleguides-and-tech-stacks.md)

### Project Markdown Mirror

<a id="project-markdown-mirror"></a>

Controls whether dashboard-authored agent presets are mirrored into project-local markdown files.

**What it controls:** The mirror toggle writes companion files under `.code-ux/agents` for selected project agents.

**Recommended defaults:** Enable it when agent instructions should be reviewable with project changes.

**Risks and gotchas:** Mirrored files can make agent edits visible in repository diffs if `.code-ux/agents` is tracked.

Related docs:

- [Agent Sync And Planning Agent](../sprint-orchestration.md)
- [Agent Routing](../sprint-orchestration.md)

### Agent Routing

<a id="agent-routing"></a>

Assigns built-in or project agent presets to planning, coding, CI, merge, dashboard, and clarification work.

**What it controls:** Coding can be manual or orchestrator-selected; each route can use a project preset or built-in fallback. The orchestrator roster uses shared multi-select option cards with selected-count feedback, keyboard focus, disabled guidance, and wrapping labels.

**Recommended defaults:** Use built-ins first, then assign specialists where project-specific instructions materially improve outcomes.

**Risks and gotchas:** Missing or overly narrow project agents can reduce task quality or block routing choices.

Related docs:

- [Agent Routing](../sprint-orchestration.md)
- [Agent Knowledge Base](../sprint-orchestration.md)

### Memory System

<a id="memory-system"></a>

Controls capture, promotion, and remediation of sprint and project memory.

**What it controls:** Enablement, sprint capture, agent capture, auto-promotion, and remediation mode decide what knowledge is stored and curated.

**Recommended defaults:** Enable memory with deterministic remediation unless you need AI-assisted cleanup.

**Risks and gotchas:** Disabling memory reduces long-term learning; AI remediation consumes routed provider capacity.

Related docs:

- [Memory Architecture and Search](./memory.md)
- [Memory Claims and Evidence](./memory.md)

### Long-Term Remediation Schedule

<a id="long-term-remediation-schedule"></a>

Schedules recurring project memory cleanup and claim maintenance.

**What it controls:** Cadence, remediation mode, and local run time create or pause a project-specific scheduler entry.

**Recommended defaults:** Use weekly deterministic cleanup for active projects with steady sprint volume.

**Risks and gotchas:** AI cleanup schedules can surprise provider budgets if routed to expensive models.

Related docs:

- [Scheduler](./scheduler.md)
- [Memory Architecture and Search](./memory.md)

### Limits

<a id="limits"></a>

Caps memory promotion thresholds, retained memories, graph density, and remediation promotions.

**What it controls:** Thresholds and maximum counts bound sprint/project memory volume and neural-map edge density.

**Recommended defaults:** Keep defaults until memory search becomes noisy or storage grows too quickly.

**Risks and gotchas:** Low limits can evict useful knowledge; high graph density can make maps harder to inspect.

Related docs:

- [Memory Architecture and Search](./memory.md)
- [Memory Claims and Evidence](./memory.md)

### Embedding Provider

<a id="embedding-provider"></a>

Chooses in-app embeddings or an external OpenAI-compatible embeddings API.

**What it controls:** Backend, external URL, model id, and API key control semantic memory embedding.

**Recommended defaults:** Use in-app models for local-first operation; use external APIs only when you need a managed embedding model.

**Risks and gotchas:** External APIs send memory text to the configured endpoint and require careful key handling.

Related docs:

- [Memory Architecture and Search](./memory.md)
- [Security Hardening](../troubleshooting.md)

### Worker Learnings Instruction

<a id="worker-learnings-instruction"></a>

Defines the prompt appended to worker tasks so useful lessons are captured for memory processing.

**What it controls:** The text area controls exactly what workers are asked to observe and write into the temporary learnings file.

**Recommended defaults:** Keep instructions specific to reusable engineering lessons and avoid asking workers to record secrets.

**Risks and gotchas:** Overbroad instructions can capture noisy or sensitive details.

Related docs:

- [Memory Architecture and Search](./memory.md)
- [Instruction Template System](../sprint-orchestration.md)

### Integrations

<a id="integrations"></a>

Lists provider, git-host, and issue-tracker integrations and exposes manage/add actions.

**What it controls:** Cards show connection state, auth hints, and management entry points; host hints can import detected local settings.

**Recommended defaults:** Configure provider credentials at system scope and use project overrides only for repository-specific git hosts.

**Risks and gotchas:** Imported hints can reveal local auth paths; verify before saving shared configuration.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Security Hardening](../troubleshooting.md)

### Jules Automation

<a id="jules-automation"></a>

Configures Jules clarification automation and CI autofix handoff behavior.

**What it controls:** Clarification auto-answer, answer mode/template, Jules CI autofix, and retry cap decide when hosted Jules automation runs.

**Recommended defaults:** Use template answers for routine clarifications and keep retry caps low.

**Risks and gotchas:** Automatic clarification replies can answer with stale assumptions if the template is too broad.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Provider Routing](../providers-and-models.md)

### Git Host Configuration

<a id="git-host-configuration"></a>

Stores GitHub or GitLab tokens and Docker git-auth behavior for repository automation.

**What it controls:** Tokens, GitHub auth mounting, auth paths, local git config copy, and container git identity control remote repository access.

**Recommended defaults:** Prefer least-privilege tokens and use local auth copy only on trusted machines.

**Risks and gotchas:** Tokens and copied auth directories can grant repository write access inside provider containers.

Related docs:

- [Security Hardening](../troubleshooting.md)
- [Operations Runbook](../troubleshooting.md)

### Jira Configuration

<a id="jira-configuration"></a>

Connects Jira issue search, import transitions, and completion transitions.

**What it controls:** Site URL, account email, API token, project key, transition names, and move/close toggles drive Jira automation.

**Recommended defaults:** Use a dedicated API token and test transition names against the target Jira workflow.

**Risks and gotchas:** Wrong transition names prevent issue movement; broad tokens expose more Jira scope than needed.

Related docs:

- [Sprint Imports](./sprints.md)
- [Security Hardening](../troubleshooting.md)

### Provider Integration

<a id="provider-integration"></a>

Explains that AI provider credentials are system-owned while project scopes still control routing and auth-copy behavior. External chat connector connections appear under Settings -> Integrations -> Chat Connectors, but they use a separate chat-provider runtime path for ingress, channel binding, and outbound reply delivery.

**What it controls:** The notices clarify where AI provider instances live, which settings remain project-scoped, and why chat connector connections are configured beside provider credentials without participating in AI model routing.

**Recommended defaults:** Switch to system scope to add AI provider credentials, then route them from AI Models. Configure chat connector connections from the provider integration cards only when an external chat bridge is ready to send authenticated ingress.

**Risks and gotchas:** Expecting project scope to create AI provider credentials can leave routes without provider instances. Expecting chat provider credentials to affect AI routing can also be misleading: chat connector connections bind external channels to projects, while AI provider credentials decide which model runs Code UX work.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [External chat connectors](../../architecture/external-chat-providers.md)
- [Configuration and Storage](../../developer/settings-reference.md)

### Provider Credentials

<a id="provider-credentials"></a>

Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults.

**What it controls:** Each instance owns API key/auth path/login/config-file mode plus routing-visible identity and availability.

**Recommended defaults:** Use named instances per account or quota pool; use Provider Config File only when a CLI needs a specific config copied.

**Risks and gotchas:** Local auth copy and config-file mounts expose host credentials to Docker-backed provider runs.

Related docs:

- [Provider Routing](../providers-and-models.md)
- [Qwen Code Integration](../providers-and-models.md)
- [OpenCode Integration](../providers-and-models.md)
- [Security Hardening](../troubleshooting.md)

### MCP Servers

<a id="mcp-servers"></a>

Lists built-in and custom MCP servers injected into provider CLI runtimes.

**What it controls:** The list configures built-in tool access, custom server enablement, transport, provider restrictions, and server creation.

**Recommended defaults:** Keep global built-in tools available for trusted project-manager clients, but leave per-agent Code UX access default-deny unless a preset has a specific need. Restrict custom servers to the CLIs and agents that need them.

**Risks and gotchas:** Broad custom MCP access can expose external tools to more providers than intended. Custom server links are separate from agent Code UX access; linking Playwright or another custom server does not imply built-in Code UX tools are enabled for that agent.

Related docs:

- [MCP Tools and Contracts](../../architecture/mcp-server.md)
- [MCP Runtime and Dispatch](../../architecture/mcp-server.md)

### Built-in MCP (Code UX)

<a id="built-in-mcp"></a>

Controls which built-in Code UX MCP tool categories are available to containerized CLIs.

**What it controls:** Tool-category and individual-tool toggles decide what trusted provider and project-manager clients may call on their next run. Agent presets add their own access layer in the Agents editor.

**Recommended defaults:** Keep the global surface aligned with project-manager workflows. Dashboard chat receives the full built-in Code UX MCP surface plus scheduler by default for the assigned reply agent. For individual non-dashboard agents, start with Code UX disabled; if built-in tools are enabled, keep scheduler disabled unless the preset specifically needs agent-owned wakeups.

**Risks and gotchas:** Disabling required tools can make provider workflows fail; enabling broad tools increases capability exposure. The restricted `scheduler_code_ux` tool lets an agent create its own wakeups, while `manage_scheduler` and other management tools expose broader runtime control. Non-chat agents should not receive scheduler or management tools unless that capability is intentional.

Related docs:

- [MCP Tools and Contracts](../../architecture/mcp-server.md)
- [Security Hardening](../troubleshooting.md)

### MCP Tool Category

<a id="mcp-tool-category"></a>

Enables or disables one built-in MCP tool category and its individual tools.

**What it controls:** The category toggle sets all tools in the group; each row can override a specific tool.

**Recommended defaults:** Keep category-level changes coarse and document why any tool is disabled.

**Risks and gotchas:** Fine-grained disablement can be hard to diagnose when a provider expects a missing tool.

Related docs:

- [MCP Tools and Contracts](../../architecture/mcp-server.md)
- [MCP Runtime and Dispatch](../../architecture/mcp-server.md)

### Custom MCP Server

<a id="custom-mcp-server"></a>

Configures one custom MCP server injected into compatible provider CLIs.

**What it controls:** Display name, server key, transport, URL or command, args/env/headers, description, CLI restrictions, and preview define the server.

**Recommended defaults:** Prefer HTTP/SSE for managed remote servers and restrict sensitive servers to specific CLIs.

**Risks and gotchas:** Invalid JSON, unavailable commands, or leaked auth headers can break provider startup or expose secrets.

Related docs:

- [External MCP Worker Client](../../architecture/mcp-server.md)
- [Security Hardening](../troubleshooting.md)

### Danger Zone

<a id="danger-zone"></a>

Groups irreversible project deletion and project override reset actions.

**What it controls:** Project reset clears saved overrides; project delete removes the project and associated local runtime data.

**Recommended defaults:** Reset overrides before deleting a project when you only need to return to inherited defaults.

**Risks and gotchas:** Delete actions are irreversible after confirmation.

Related docs:

- [Operations Runbook](../troubleshooting.md)
- [Configuration and Storage](../../developer/settings-reference.md)

### Project Memory

<a id="project-memory"></a>

Clears selected memory tiers for the active project only.

**What it controls:** Short-term, long-term, and all-memory actions remove progressively broader memory records.

**Recommended defaults:** Clear short-term first when fixing noisy sprint memory; use all-memory only for a full project memory reset.

**Risks and gotchas:** Clearing long-term or all memory removes claims, evidence, and vectors permanently.

Related docs:

- [Memory Claims and Evidence](./memory.md)
- [Memory Architecture and Search](./memory.md)

### System Memory

<a id="system-memory"></a>

Clears memory tiers across every project in the local database.

**What it controls:** Short-term, long-term, and all-memory actions apply globally.

**Recommended defaults:** Use only during local maintenance or after confirming no project needs the retained knowledge.

**Risks and gotchas:** System memory clears are broad and irreversible.

Related docs:

- [Memory Claims and Evidence](./memory.md)
- [Operations Runbook](../troubleshooting.md)

### System Database

<a id="system-database"></a>

Wipes the local Code UX database so the app returns to a clean state on reload.

**What it controls:** The hard reset action removes projects, sprints, tasks, histories, and system state.

**Recommended defaults:** Use only for local reset or unrecoverable database corruption after exporting anything needed.

**Risks and gotchas:** This deletes all local runtime state and cannot be undone from the dashboard.

Related docs:

- [Configuration and Storage](../../developer/settings-reference.md)
- [Operations Runbook](../troubleshooting.md)
