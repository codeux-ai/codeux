# Settings

Settings is the configuration hub for Code UX. It covers local runtime behavior, provider routing, project overrides, Git and CI automation, dashboard appearance, memory, integrations, MCP tool access, and destructive maintenance actions.

Use this section when you need more detail than the inline Settings-page help popovers provide. Every Settings card links to one of the pages below, and each page explains what the controls affect, recommended defaults, common risks, and validation steps.

## How Settings Scope Works

| Scope | Use it for | Watch for |
| --- | --- | --- |
| System | Defaults shared by every project, provider credentials, global runtime behavior, and reusable catalogs. | A system change can affect future work across projects. |
| Project | Repository-specific routing, preview behavior, memory, integrations, and workflow policy. | Project overrides can mask system defaults. |
| Sprint | Narrow execution overrides where supported by the runtime. | Use sparingly so sprint behavior stays explainable. |

## Settings Areas

### Scope, Runtime, And Workspace

| Area | What it covers |
| --- | --- |
| [Project Context](./project-context.md) | Names and identifies the active project without changing the stored project id or execution history. |
| [Automation](./automation.md) | Controls how much Code UX may continue without pausing for operator decisions. |
| [Docker Runtime](./docker-runtime.md) | Defines the default container environment used by Docker-backed provider CLIs. |
| [System Runtime](./system-runtime.md) | Configures dashboard port and runtime logging behavior for the local Code UX process. |
| [Restart Behavior](./restart-behavior.md) | Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts. |
| [Database Settings](./database-settings.md) | Manages local SQLite retention and maintenance for runtime activity data. |
| [Onboarding](./onboarding.md) | Reopens the guided setup flow without changing saved settings by itself. |

### Appearance And Guidance

| Area | What it covers |
| --- | --- |
| [Display Settings](./display-settings.md) | Controls the dashboard shell layout, theme, motion preference, and desktop zoom when available. |
| [Background](./background.md) | Customizes the dashboard background image, animation mode, static color, and pattern overlay. |
| [Techstacks](./techstacks.md) | Manages the system techstack catalog and per-project techstack/application-kind assignment. |
| [Guidance](./guidance.md) | Manages selected tech-stack and styleguide guidance plus custom instruction entries for the active settings scope. |
| [Default Routing Anchors](./default-routing-anchors.md) | Sets the global and worker provider instances used when invocation routes inherit defaults. |

### Provider Routing And Models

| Area | What it covers |
| --- | --- |
| [Speech Output Architecture](../architecture/speech-output.md) | Installs and activates STT/TTS ONNX bundles, configures API variants, and controls the 3D Chat project-manager voice. |
| [Base Provider Configuration](./base-provider-configuration.md) | Defines each named provider instance's default eligibility, model, thinking depth, weight, and concurrency. |
| [Route Mapping](./route-mapping.md) | Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools. |
| [Model Pricing](./model-pricing.md) | Stores token pricing metadata used for model cost estimates in dashboard views. |
| [Provider Integration](./provider-integration.md) | Explains that provider credentials are system-owned while project scopes still control routing and auth-copy behavior. |
| [Provider Credentials](./provider-credentials.md) | Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults. |

### Git, CI, QA, And Execution Safety

| Area | What it covers |
| --- | --- |
| [Git Flow](./git-flow.md) | Controls branch naming, PR creation, issue closure, and cleanup for sprint work. |
| [Merge Gates & Autofix](./merge-gates-autofix.md) | Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges. |
| [Quality Assurance](./quality-assurance.md) | Controls completion-time QA review, QA routing, and trigger-specific agent assignment. |
| [Guardrails](./guardrails.md) | Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably. |
| [Rate Limit](./rate-limit.md) | Controls retries after provider quota or rate-limit responses. |
| [Watch Loop](./watch-loop.md) | Controls whether live sprint orchestration keeps polling and how frequently it emits work. |
| [Workspace Hygiene](./workspace-hygiene.md) | Controls cleanup of temporary worktree state after provider CLI runs. |
| [Workspace Visibility](./workspace-visibility.md) | Controls automatic preview lifecycle and whether browser workspace entry points appear in the dashboard. |
| [Runtime Limits](./runtime-limits.md) | Sets preview container concurrency, ports, startup commands, and optional Docker access. |

### Memory And Knowledge

| Area | What it covers |
| --- | --- |
| [Memory System](./memory-system.md) | Controls capture, promotion, and remediation of sprint and project memory. |
| [Long-Term Remediation Schedule](./long-term-remediation-schedule.md) | Schedules recurring project memory cleanup and claim maintenance. |
| [Limits](./limits.md) | Caps memory promotion thresholds, retained memories, graph density, and remediation promotions. |
| [Embedding Provider](./embedding-provider.md) | Chooses in-app embeddings or an external OpenAI-compatible embeddings API. |
| [Worker Learnings Instruction](./worker-learnings-instruction.md) | Defines the prompt appended to worker tasks so useful lessons are captured for memory processing. |
| [Project Memory](./project-memory.md) | Clears selected memory tiers for the active project only. |
| [System Memory](./system-memory.md) | Clears memory tiers across every project in the local database. |

### Integrations And Imports

| Area | What it covers |
| --- | --- |
| [Integrations](./integrations.md) | Lists provider, git-host, issue-tracker, and read-only importer integrations and exposes manage/add actions. |
| [Jules Automation](./jules-automation.md) | Configures Jules clarification automation and CI autofix handoff behavior. |
| [Git Host Configuration](./git-host-configuration.md) | Stores GitHub or GitLab tokens and Docker git-auth behavior for repository automation. |
| [Jira Configuration](./jira-configuration.md) | Connects Jira issue search, import transitions, and completion transitions. |
| [Importer Configuration](./importer-configuration.md) | Configures read-only external work imports for project management, whiteboard, diagram, and design providers. |

### MCP And Tool Access

| Area | What it covers |
| --- | --- |
| [MCP Servers](./mcp-servers.md) | Lists built-in and custom MCP servers injected into provider CLI runtimes. |
| [Built-in MCP (Code UX)](./built-in-mcp.md) | Controls which built-in Code UX MCP tool categories are available to containerized CLIs. |
| [MCP Tool Category](./mcp-tool-category.md) | Enables or disables one built-in MCP tool category and its individual tools. |
| [Custom MCP Server](./custom-mcp-server.md) | Configures one custom MCP server injected into compatible provider CLIs. |

### Destructive Operations

| Area | What it covers |
| --- | --- |
| [Danger Zone](./danger-zone.md) | Groups irreversible project deletion and project override reset actions. |
| [System Database](./system-database.md) | Wipes the local Code UX database so the app returns to a clean state on reload. |
| [Project Markdown Mirror](./project-markdown-mirror.md) | Controls whether dashboard-authored agent presets are mirrored into project-local markdown files. |
| [Agent Routing](./agent-routing.md) | Assigns built-in or project agent presets to planning, coding, CI, merge, dashboard, and clarification work. |

## Recommended Operating Pattern

1. Start with the Settings page in System scope and configure only the defaults that should apply everywhere.
2. Switch to Project scope for repository-specific provider routing, preview, memory, importer, or Git behavior.
3. Use the card-level documentation links for exact implications before changing high-impact areas such as credentials, Docker runtime, merge gates, memory deletion, or database reset.
4. Validate by rerunning the smallest workflow that exercises the changed setting: reload the dashboard for appearance changes, start a preview for preview changes, or run a test sprint for routing and automation changes.

## Related Documentation

- [Dashboard Settings](../../docs-web/user/dashboard/settings.md)
- [Configuration and Storage](../configuration-and-storage.md)
- [Provider Routing](../provider-routing.md)
