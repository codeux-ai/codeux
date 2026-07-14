import type { PageMeta } from '../../lib/page-meta'

export type DocsSection = 'Getting Started' | 'User Guide' | 'Developer Reference' | 'Architecture'

export type DocsSlug =
  | 'docs-overview'
  | 'user-introduction'
  | 'user-installation'
  | 'user-quickstart'
  | 'user-overview'
  | 'user-mcp-clients'
  | 'user-sprint-orchestration'
  | 'user-providers-and-models'
  | 'user-automation-and-ci'
  | 'user-quicksprints'
  | 'user-troubleshooting'
  | 'user-dashboard-overview'
  | 'user-dashboard-internationalization'
  | 'user-dashboard-projects'
  | 'user-dashboard-sprints'
  | 'user-dashboard-tasks'
  | 'user-dashboard-live-session'
  | 'user-dashboard-chat'
  | 'user-dashboard-agents'
  | 'user-dashboard-nodes'
  | 'user-dashboard-nodes-canvas'
  | 'user-dashboard-node-flows'
  | 'user-dashboard-scheduler'
  | 'user-dashboard-memory'
  | 'user-dashboard-knowledge'
  | 'user-dashboard-file-browser'
  | 'user-dashboard-browser-preview'
  | 'user-dashboard-stats'
  | 'user-dashboard-settings'
  | 'user-dashboard-styleguides-and-tech-stacks'
  | 'settings-overview'
  | 'settings-project-context'
  | 'settings-automation'
  | 'settings-docker-runtime'
  | 'settings-system-runtime'
  | 'settings-restart-behavior'
  | 'settings-database-settings'
  | 'settings-onboarding'
  | 'settings-display-settings'
  | 'settings-background'
  | 'settings-default-routing-anchors'
  | 'settings-base-provider-configuration'
  | 'settings-route-mapping'
  | 'settings-model-pricing'
  | 'settings-git-flow'
  | 'settings-merge-gates-autofix'
  | 'settings-quality-assurance'
  | 'settings-guardrails'
  | 'settings-rate-limit'
  | 'settings-watch-loop'
  | 'settings-workspace-hygiene'
  | 'settings-workspace-visibility'
  | 'settings-runtime-limits'
  | 'settings-techstacks'
  | 'settings-guidance'
  | 'settings-project-markdown-mirror'
  | 'settings-agent-routing'
  | 'settings-memory-system'
  | 'settings-long-term-remediation-schedule'
  | 'settings-limits'
  | 'settings-embedding-provider'
  | 'settings-worker-learnings-instruction'
  | 'settings-integrations'
  | 'settings-jules-automation'
  | 'settings-git-host-configuration'
  | 'settings-jira-configuration'
  | 'settings-importer-configuration'
  | 'settings-provider-integration'
  | 'settings-provider-credentials'
  | 'settings-mcp-servers'
  | 'settings-built-in-mcp'
  | 'settings-mcp-tool-category'
  | 'settings-custom-mcp-server'
  | 'settings-danger-zone'
  | 'settings-project-memory'
  | 'settings-system-memory'
  | 'settings-system-database'
  | 'developer-overview'
  | 'developer-mcp-tools'
  | 'developer-management-actions'
  | 'developer-http-api'
  | 'developer-websocket-realtime'
  | 'developer-configuration'
  | 'developer-feature-flags'
  | 'developer-settings-reference'
  | 'developer-sprint-format'
  | 'developer-building-from-source'
  | 'developer-testing'
  | 'developer-orchestration-debugging'
  | 'architecture-overview'
  | 'architecture-system-overview'
  | 'architecture-mcp-server'
  | 'architecture-sprint-engine'
  | 'architecture-virtual-workers'
  | 'architecture-ci-integration'
  | 'architecture-dashboard-architecture'
  | 'architecture-data-model'
  | 'architecture-execution-invocation-tracking'
  | 'architecture-external-chat-providers'
  | 'architecture-configuration-resolution'
  | 'architecture-security'
  | 'operations-credential-security'
  | 'operations-runbook'
  | 'operations-security-hardening'
  | 'operations-server-mode'
  | 'settings-google-drive-mount'
  | 'user-dashboard-custom-dashboards'
  | 'architecture-card-ci-status-projection'
  | 'architecture-custom-dashboard-foundation'
  | 'architecture-custom-nodes'
  | 'architecture-dashboard-internationalization'
  | 'architecture-managed-container-runtime'
  | 'architecture-node-flow-builtins-and-security'
  | 'architecture-node-flow-durable-execution'
  | 'architecture-node-flow-foundation'
  | 'architecture-node-flows'
  | 'architecture-speech-input'
  | 'architecture-speech-output'
  | 'architecture-sprint-rollbacks'
  | 'architecture-worker-clarification-contract'

export interface DocsRegistryEntry extends Partial<Omit<PageMeta, 'title' | 'description'>> {
  id: DocsSlug
  path: string
  section: DocsSection
  title: string
  description: string
}

export const docsRegistry: Record<DocsSlug, DocsRegistryEntry> = {
  'docs-overview': {
    id: 'docs-overview',
    path: '/docs/docs-overview',
    section: 'Getting Started',
    title: "Code UX Documentation",
    description: "Code UX is a local-first, container-first multi-provider runtime. It turns a goal into a managed sprint — planned, routed to the right agent, executed in isolated Docker workspaces, reviewed through Git and CI, and tr...",
  },
  'user-introduction': {
    id: 'user-introduction',
    path: '/docs/user-introduction',
    section: 'Getting Started',
    title: "Introduction",
    description: "Code UX is an open-source, container-first agentic coding runtime. You describe a piece of work — a feature, refactor, migration, QA pass, or CI repair — and Code UX turns it into a managed sprint: planned into depend...",
  },
  'user-installation': {
    id: 'user-installation',
    path: '/docs/user-installation',
    section: 'Getting Started',
    title: "Installation",
    description: "Code UX runs entirely on your machine. You can install it as a desktop app or build it from source — both ship the same runtime, dashboard, and MCP server. You can install and start Code UX with no configuration; prov...",
  },
  'user-quickstart': {
    id: 'user-quickstart',
    path: '/docs/user-quickstart',
    section: 'Getting Started',
    title: "Quickstart",
    description: "This guide takes you from a clean install to a finished sprint in about ten minutes. You will start Code UX, create a project, plan a small sprint with the AI planner, run it, and watch it merge.",
  },
  'user-overview': {
    id: 'user-overview',
    path: '/docs/user-overview',
    section: 'User Guide',
    title: "User Guide",
    description: "Welcome to Code UX — a local-first, container-first multi-provider runtime. This section is for people running sprints, whether from the local dashboard or an MCP client.",
  },
  'user-mcp-clients': {
    id: 'user-mcp-clients',
    path: '/docs/user-mcp-clients',
    section: 'User Guide',
    title: "Connecting MCP clients",
    description: "Besides its dashboard, Code UX is also a Model Context Protocol (MCP) server. Any MCP-compatible client can connect to it and call its tools — so you can drive projects and sprints from the Gemini CLI, Codex, Claude C...",
  },
  'user-sprint-orchestration': {
    id: 'user-sprint-orchestration',
    path: '/docs/user-sprint-orchestration',
    section: 'User Guide',
    title: "Sprint orchestration in depth",
    description: "This page is the canonical reference for how a sprint runs end to end. It is written for users who want to understand and tune the orchestrator — not just drive it.",
  },
  'user-providers-and-models': {
    id: 'user-providers-and-models',
    path: '/docs/user-providers-and-models',
    section: 'User Guide',
    title: "Providers and models",
    description: "Code UX dispatches work across seven providers, each accepting one or more models. This page is the catalog plus the routing system that decides which provider answers which kind of work.",
  },
  'user-automation-and-ci': {
    id: 'user-automation-and-ci',
    path: '/docs/user-automation-and-ci',
    section: 'User Guide',
    title: "Automation, CI and merge policy",
    description: "Code UX integrates with your existing GitHub-based CI to gate merges, automatically retry CI fixes, and surface the rest as attention items. This page describes those policies and how to tune them.",
  },
  'user-quicksprints': {
    id: 'user-quicksprints',
    path: '/docs/user-quicksprints',
    section: 'User Guide',
    title: "Quicksprint templates",
    description: "A quicksprint template is a reusable, parameterised sprint definition that you can spawn into a project with one click.",
  },
  'user-troubleshooting': {
    id: 'user-troubleshooting',
    path: '/docs/user-troubleshooting',
    section: 'User Guide',
    title: "Troubleshooting",
    description: "Solutions to the most common issues. If your problem is not covered here, see the system overview, the MCP client guide, or open an issue.",
  },
  'user-dashboard-overview': {
    id: 'user-dashboard-overview',
    path: '/docs/user-dashboard-overview',
    section: 'User Guide',
    title: "The Dashboard",
    description: "The Code UX dashboard is a real-time Preact application served at http://localhost:4444 (configurable with DASHBOARD_PORT). It is the primary interface for humans operating Code UX.",
  },
  'user-dashboard-internationalization': {
    id: 'user-dashboard-internationalization',
    path: '/docs/user-dashboard-internationalization',
    section: 'User Guide',
    title: "Dashboard Language and Internationalization",
    description: "The Code UX dashboard supports English and German interface copy. English is the default when no valid saved preference exists. Code UX does not detect a language from your browser, synchronize the choice to the backe...",
  },
  'user-dashboard-projects': {
    id: 'user-dashboard-projects',
    path: '/docs/user-dashboard-projects',
    section: 'User Guide',
    title: "Projects",
    description: "The Projects page (/projects) presents every managed repository in a low-noise gallery and lets you create, select, configure, set up, and delete projects. The restrained project cards use quiet surfaces and semantic...",
  },
  'user-dashboard-sprints': {
    id: 'user-dashboard-sprints',
    path: '/docs/user-dashboard-sprints',
    section: 'User Guide',
    title: "Sprints",
    description: "The Sprints page (/sprints) is where you plan, manage, and launch sprint runs.",
  },
  'user-dashboard-tasks': {
    id: 'user-dashboard-tasks',
    path: '/docs/user-dashboard-tasks',
    section: 'User Guide',
    title: "Tasks",
    description: "The Tasks page (/tasks) is a Kanban-style task board for the active project. It organizes tasks into Queued, In Progress, and Completed lanes, with sprint scope, status, priority, and search controls above the board.",
  },
  'user-dashboard-live-session': {
    id: 'user-dashboard-live-session',
    path: '/docs/user-dashboard-live-session',
    section: 'User Guide',
    title: "Live Session",
    description: "The Live Session page (/live) is the real-time control room for an active sprint run.",
  },
  'user-dashboard-chat': {
    id: 'user-dashboard-chat',
    path: '/docs/user-dashboard-chat',
    section: 'User Guide',
    title: "Chat",
    description: "The Chat page (/chat) is a thread-based conversation surface that lets you talk to agents for project-backed Q&A, inspect execution invocation transcripts and MCP tool invocations, and get local onboarding help before...",
  },
  'user-dashboard-agents': {
    id: 'user-dashboard-agents',
    path: '/docs/user-dashboard-agents',
    section: 'User Guide',
    title: "Agents",
    description: "The Agents page (/agents) manages the agent presets available to the active project.",
  },
  'user-dashboard-nodes': {
    id: 'user-dashboard-nodes',
    path: '/docs/user-dashboard-nodes',
    section: 'User Guide',
    title: "Nodes",
    description: "The Nodes page (/nodes) is the project-scoped backend workspace for authoring and operating governed node flows. Select a project to load its flow library, credential metadata, publications, and durable run history; w...",
  },
  'user-dashboard-nodes-canvas': {
    id: 'user-dashboard-nodes-canvas',
    path: '/docs/user-dashboard-nodes-canvas',
    section: 'User Guide',
    title: "Nodes Canvas",
    description: "The Nodes page (/nodes) is a project-scoped Graph v2 workspace backed by the Code UX node-flow APIs. Select a project to load its flow library, credential metadata, publications, and run history. Changing projects cle...",
  },
  'user-dashboard-node-flows': {
    id: 'user-dashboard-node-flows',
    path: '/docs/user-dashboard-node-flows',
    section: 'User Guide',
    title: "Node Flows",
    description: "The Nodes page (/nodes) is the project-scoped backend authoring, publication, and operations surface for canonical node flows. No selected project means no flow library, credential metadata, publications, or durable r...",
  },
  'user-dashboard-scheduler': {
    id: 'user-dashboard-scheduler',
    path: '/docs/user-dashboard-scheduler',
    section: 'User Guide',
    title: "Scheduler",
    description: "The Scheduler page (dock label Schedule, /scheduler) runs Code UX work on a timetable. Schedule a sprint, a quicksprint template, a node flow, a project message, or memory remediation to fire once or on a recurring ca...",
  },
  'user-dashboard-memory': {
    id: 'user-dashboard-memory',
    path: '/docs/user-dashboard-memory',
    section: 'User Guide',
    title: "Memory",
    description: "The Memory page (/memory) manages Code UX's two-tier semantic memory system. Embedding and speech models are installed from Settings -&gt; AI Models.",
  },
  'user-dashboard-knowledge': {
    id: 'user-dashboard-knowledge',
    path: '/docs/user-dashboard-knowledge',
    section: 'User Guide',
    title: "Knowledge",
    description: "The Knowledge page (/knowledge) is a per-project knowledge base. You add documents, Code UX chunks and embeds them, and agents can retrieve the relevant pieces during planning and coding — giving them grounded project...",
  },
  'user-dashboard-file-browser': {
    id: 'user-dashboard-file-browser',
    path: '/docs/user-dashboard-file-browser',
    section: 'User Guide',
    title: "File Browser",
    description: "The File Browser page (dock label Files, /files) lets you inspect a project's files and review a sprint's Git changes from inside the dashboard, without switching to a terminal or editor.",
  },
  'user-dashboard-browser-preview': {
    id: 'user-dashboard-browser-preview',
    path: '/docs/user-dashboard-browser-preview',
    section: 'User Guide',
    title: "Sprint Preview Browser",
    description: "The Browser page (/browser) lets you spin up a Docker container per sprint that runs your application — and view it through an embedded browser-like surface inside the dashboard.",
  },
  'user-dashboard-stats': {
    id: 'user-dashboard-stats',
    path: '/docs/user-dashboard-stats',
    section: 'User Guide',
    title: "Stats",
    description: "The Stats page (/stats) is the analytics surface for the active project. It shows project execution, usage, cost, Git, provider/model, ledger, and invocation telemetry in one flat Analysis Studio with responsive layou...",
  },
  'user-dashboard-settings': {
    id: 'user-dashboard-settings',
    path: '/docs/user-dashboard-settings',
    section: 'User Guide',
    title: "Settings",
    description: "The Settings page (/config) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.",
  },
  'user-dashboard-styleguides-and-tech-stacks': {
    id: 'user-dashboard-styleguides-and-tech-stacks',
    path: '/docs/user-dashboard-styleguides-and-tech-stacks',
    section: 'User Guide',
    title: "Styleguides and Tech Stacks",
    description: "Code UX uses guidance selections to tell workers what implementation stack and product style they should respect.",
  },
  'settings-overview': {
    id: 'settings-overview',
    path: '/docs/settings-overview',
    section: 'User Guide',
    title: "Settings",
    description: "Settings is the configuration hub for Code UX. It covers local runtime behavior, provider routing, project overrides, Git and CI automation, dashboard appearance, memory, integrations, MCP tool access, and destructive...",
  },
  'settings-project-context': {
    id: 'settings-project-context',
    path: '/docs/settings-project-context',
    section: 'User Guide',
    title: "Project Context",
    description: "Names and identifies the active project without changing the stored project id or execution history.",
  },
  'settings-automation': {
    id: 'settings-automation',
    path: '/docs/settings-automation',
    section: 'User Guide',
    title: "Automation",
    description: "Controls how much Code UX may continue without pausing for operator decisions.",
  },
  'settings-docker-runtime': {
    id: 'settings-docker-runtime',
    path: '/docs/settings-docker-runtime',
    section: 'User Guide',
    title: "Docker Runtime",
    description: "Code UX defaults to a managed, auto-updating Linux runtime instead of building an agent image on each user's machine.",
  },
  'settings-system-runtime': {
    id: 'settings-system-runtime',
    path: '/docs/settings-system-runtime',
    section: 'User Guide',
    title: "System Runtime",
    description: "Configures dashboard port and runtime logging behavior for the local Code UX process.",
  },
  'settings-restart-behavior': {
    id: 'settings-restart-behavior',
    path: '/docs/settings-restart-behavior',
    section: 'User Guide',
    title: "Restart Behavior",
    description: "Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts.",
  },
  'settings-database-settings': {
    id: 'settings-database-settings',
    path: '/docs/settings-database-settings',
    section: 'User Guide',
    title: "Database Settings",
    description: "Manages local SQLite retention and maintenance for runtime activity data.",
  },
  'settings-onboarding': {
    id: 'settings-onboarding',
    path: '/docs/settings-onboarding',
    section: 'User Guide',
    title: "Onboarding",
    description: "Reopens the guided setup flow without changing saved settings by itself.",
  },
  'settings-display-settings': {
    id: 'settings-display-settings',
    path: '/docs/settings-display-settings',
    section: 'User Guide',
    title: "Display Settings",
    description: "Controls the dashboard shell layout, language, theme, accent color, motion preference, and desktop zoom when available.",
  },
  'settings-background': {
    id: 'settings-background',
    path: '/docs/settings-background',
    section: 'User Guide',
    title: "Background",
    description: "Customizes the dashboard background image, animation mode, static color, and pattern overlay.",
  },
  'settings-default-routing-anchors': {
    id: 'settings-default-routing-anchors',
    path: '/docs/settings-default-routing-anchors',
    section: 'User Guide',
    title: "Default Routing Anchors",
    description: "Sets the global and worker provider instances used when invocation routes inherit defaults.",
  },
  'settings-base-provider-configuration': {
    id: 'settings-base-provider-configuration',
    path: '/docs/settings-base-provider-configuration',
    section: 'User Guide',
    title: "Base Provider Configuration",
    description: "Defines each named provider instance's default eligibility, model, thinking depth, weight, and concurrency.",
  },
  'settings-route-mapping': {
    id: 'settings-route-mapping',
    path: '/docs/settings-route-mapping',
    section: 'User Guide',
    title: "Route Mapping",
    description: "Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.",
  },
  'settings-model-pricing': {
    id: 'settings-model-pricing',
    path: '/docs/settings-model-pricing',
    section: 'User Guide',
    title: "Model Pricing",
    description: "Stores token pricing metadata used for model cost estimates in dashboard views.",
  },
  'settings-git-flow': {
    id: 'settings-git-flow',
    path: '/docs/settings-git-flow',
    section: 'User Guide',
    title: "Git Flow",
    description: "Controls branch naming, PR creation, issue closure, and cleanup for sprint work.",
  },
  'settings-merge-gates-autofix': {
    id: 'settings-merge-gates-autofix',
    path: '/docs/settings-merge-gates-autofix',
    section: 'User Guide',
    title: "Merge Gates & Autofix",
    description: "Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges.",
  },
  'settings-quality-assurance': {
    id: 'settings-quality-assurance',
    path: '/docs/settings-quality-assurance',
    section: 'User Guide',
    title: "Quality Assurance",
    description: "Controls completion-time QA review, QA routing, and trigger-specific agent assignment.",
  },
  'settings-guardrails': {
    id: 'settings-guardrails',
    path: '/docs/settings-guardrails',
    section: 'User Guide',
    title: "Guardrails",
    description: "Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably.",
  },
  'settings-rate-limit': {
    id: 'settings-rate-limit',
    path: '/docs/settings-rate-limit',
    section: 'User Guide',
    title: "Rate Limit",
    description: "Controls retries after provider quota or rate-limit responses.",
  },
  'settings-watch-loop': {
    id: 'settings-watch-loop',
    path: '/docs/settings-watch-loop',
    section: 'User Guide',
    title: "Watch Loop",
    description: "Controls whether live sprint orchestration keeps polling and how frequently it emits work.",
  },
  'settings-workspace-hygiene': {
    id: 'settings-workspace-hygiene',
    path: '/docs/settings-workspace-hygiene',
    section: 'User Guide',
    title: "Workspace Hygiene",
    description: "Controls cleanup of temporary worktree state after provider CLI runs.",
  },
  'settings-workspace-visibility': {
    id: 'settings-workspace-visibility',
    path: '/docs/settings-workspace-visibility',
    section: 'User Guide',
    title: "Workspace Visibility",
    description: "Controls automatic preview lifecycle and whether browser workspace entry points appear in the dashboard.",
  },
  'settings-runtime-limits': {
    id: 'settings-runtime-limits',
    path: '/docs/settings-runtime-limits',
    section: 'User Guide',
    title: "Runtime Limits",
    description: "Sets preview container concurrency, ports, startup behavior, and optional Docker daemon access.",
  },
  'settings-techstacks': {
    id: 'settings-techstacks',
    path: '/docs/settings-techstacks',
    section: 'User Guide',
    title: "Techstacks",
    description: "Manages the system techstack catalog and per-project techstack/application-kind assignment.",
  },
  'settings-guidance': {
    id: 'settings-guidance',
    path: '/docs/settings-guidance',
    section: 'User Guide',
    title: "Guidance",
    description: "Manages selected tech-stack and styleguide guidance plus custom instruction entries for the active settings scope.",
  },
  'settings-project-markdown-mirror': {
    id: 'settings-project-markdown-mirror',
    path: '/docs/settings-project-markdown-mirror',
    section: 'User Guide',
    title: "Project Markdown Mirror",
    description: "Controls whether dashboard-authored agent presets are mirrored into project-local markdown files.",
  },
  'settings-agent-routing': {
    id: 'settings-agent-routing',
    path: '/docs/settings-agent-routing',
    section: 'User Guide',
    title: "Agent Routing",
    description: "Assigns built-in or project agent presets to planning, coding, CI, merge, dashboard, and clarification work.",
  },
  'settings-memory-system': {
    id: 'settings-memory-system',
    path: '/docs/settings-memory-system',
    section: 'User Guide',
    title: "Memory System",
    description: "Controls capture, promotion, and remediation of sprint and project memory.",
  },
  'settings-long-term-remediation-schedule': {
    id: 'settings-long-term-remediation-schedule',
    path: '/docs/settings-long-term-remediation-schedule',
    section: 'User Guide',
    title: "Long-Term Remediation Schedule",
    description: "Schedules recurring project memory cleanup and claim maintenance.",
  },
  'settings-limits': {
    id: 'settings-limits',
    path: '/docs/settings-limits',
    section: 'User Guide',
    title: "Limits",
    description: "Caps memory promotion thresholds, retained memories, graph density, and remediation promotions.",
  },
  'settings-embedding-provider': {
    id: 'settings-embedding-provider',
    path: '/docs/settings-embedding-provider',
    section: 'User Guide',
    title: "Embedding Provider",
    description: "Chooses in-app embeddings or an external OpenAI-compatible embeddings API.",
  },
  'settings-worker-learnings-instruction': {
    id: 'settings-worker-learnings-instruction',
    path: '/docs/settings-worker-learnings-instruction',
    section: 'User Guide',
    title: "Worker Learnings Instruction",
    description: "Defines the prompt appended to worker tasks so useful lessons are captured for memory processing.",
  },
  'settings-integrations': {
    id: 'settings-integrations',
    path: '/docs/settings-integrations',
    section: 'User Guide',
    title: "Integrations",
    description: "Lists provider, git-host, issue-tracker, and read-only importer integrations and exposes manage/add actions.",
  },
  'settings-jules-automation': {
    id: 'settings-jules-automation',
    path: '/docs/settings-jules-automation',
    section: 'User Guide',
    title: "Jules Automation",
    description: "Configures Jules clarification automation and CI autofix handoff behavior.",
  },
  'settings-git-host-configuration': {
    id: 'settings-git-host-configuration',
    path: '/docs/settings-git-host-configuration',
    section: 'User Guide',
    title: "Git Host Configuration",
    description: "Stores GitHub or GitLab tokens and Docker git-auth behavior for repository automation.",
  },
  'settings-jira-configuration': {
    id: 'settings-jira-configuration',
    path: '/docs/settings-jira-configuration',
    section: 'User Guide',
    title: "Jira Configuration",
    description: "Connects Jira issue search, import transitions, and completion transitions.",
  },
  'settings-importer-configuration': {
    id: 'settings-importer-configuration',
    path: '/docs/settings-importer-configuration',
    section: 'User Guide',
    title: "Importer Configuration",
    description: "Configures read-only external work imports for project management, whiteboard, diagram, and design providers.",
  },
  'settings-provider-integration': {
    id: 'settings-provider-integration',
    path: '/docs/settings-provider-integration',
    section: 'User Guide',
    title: "Provider Integration",
    description: "Explains that provider credentials are system-owned while project scopes still control routing and auth-copy behavior.",
  },
  'settings-provider-credentials': {
    id: 'settings-provider-credentials',
    path: '/docs/settings-provider-credentials',
    section: 'User Guide',
    title: "Provider Credentials",
    description: "Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults.",
  },
  'settings-mcp-servers': {
    id: 'settings-mcp-servers',
    path: '/docs/settings-mcp-servers',
    section: 'User Guide',
    title: "MCP Servers",
    description: "Lists built-in and custom MCP servers injected into provider CLI runtimes.",
  },
  'settings-built-in-mcp': {
    id: 'settings-built-in-mcp',
    path: '/docs/settings-built-in-mcp',
    section: 'User Guide',
    title: "Built-in MCP (Code UX)",
    description: "Controls which built-in Code UX MCP tool categories are available to containerized CLIs.",
  },
  'settings-mcp-tool-category': {
    id: 'settings-mcp-tool-category',
    path: '/docs/settings-mcp-tool-category',
    section: 'User Guide',
    title: "MCP Tool Category",
    description: "Enables or disables one built-in MCP tool category and its individual tools.",
  },
  'settings-custom-mcp-server': {
    id: 'settings-custom-mcp-server',
    path: '/docs/settings-custom-mcp-server',
    section: 'User Guide',
    title: "Custom MCP Server",
    description: "Configures one custom MCP server injected into compatible provider CLIs.",
  },
  'settings-danger-zone': {
    id: 'settings-danger-zone',
    path: '/docs/settings-danger-zone',
    section: 'User Guide',
    title: "Danger Zone",
    description: "Groups irreversible project deletion and project override reset actions.",
  },
  'settings-project-memory': {
    id: 'settings-project-memory',
    path: '/docs/settings-project-memory',
    section: 'User Guide',
    title: "Project Memory",
    description: "Clears selected memory tiers for the active project only.",
  },
  'settings-system-memory': {
    id: 'settings-system-memory',
    path: '/docs/settings-system-memory',
    section: 'User Guide',
    title: "System Memory",
    description: "Clears memory tiers across every project in the local database.",
  },
  'settings-system-database': {
    id: 'settings-system-database',
    path: '/docs/settings-system-database',
    section: 'User Guide',
    title: "System Database",
    description: "Wipes the local Code UX database so the app returns to a clean state on reload.",
  },
  'developer-overview': {
    id: 'developer-overview',
    path: '/docs/developer-overview',
    section: 'Developer Reference',
    title: "Developer Reference",
    description: "This section is the precise contract reference for everyone integrating with Code UX — whether you are wiring it into an MCP client, building a dashboard plugin, or extending the engine.",
  },
  'developer-mcp-tools': {
    id: 'developer-mcp-tools',
    path: '/docs/developer-mcp-tools',
    section: 'Developer Reference',
    title: "MCP tools",
    description: "Code UX is also an MCP server. When connected, it advertises a set of management tools that an MCP client (or another agent) can call to drive projects, sprints, tasks, agents, memory, persistent skills, node flows, s...",
  },
  'developer-management-actions': {
    id: 'developer-management-actions',
    path: '/docs/developer-management-actions',
    section: 'Developer Reference',
    title: "Management actions",
    description: "Code UX exposes one MCP tool per management domain — manage_projects, manage_sprints, manage_tasks, manage_quicksprints, manage_scheduler, manage_agents, manage_node_flows, manage_memory, manage_settings, manage_previ...",
  },
  'developer-http-api': {
    id: 'developer-http-api',
    path: '/docs/developer-http-api',
    section: 'Developer Reference',
    title: "HTTP API reference",
    description: "The Code UX dashboard process exposes a REST API on the same port as the dashboard UI (default 4444). All endpoints return JSON unless otherwise noted.",
  },
  'developer-websocket-realtime': {
    id: 'developer-websocket-realtime',
    path: '/docs/developer-websocket-realtime',
    section: 'Developer Reference',
    title: "Realtime WebSocket protocol",
    description: "The dashboard subscribes to /api/realtime (WebSocket) for push updates. This page documents the wire protocol for clients that want to consume the same stream programmatically.",
  },
  'developer-configuration': {
    id: 'developer-configuration',
    path: '/docs/developer-configuration',
    section: 'Developer Reference',
    title: "Configuration & CLI",
    description: "This page is the precise reference for every CLI flag, environment variable, and configuration file Code UX consumes.",
  },
  'developer-feature-flags': {
    id: 'developer-feature-flags',
    path: '/docs/developer-feature-flags',
    section: 'Developer Reference',
    title: "Dashboard Feature Flags",
    description: "Dashboard feature flags hide unfinished dashboard surfaces without deleting their implementation or tests.",
  },
  'developer-settings-reference': {
    id: 'developer-settings-reference',
    path: '/docs/developer-settings-reference',
    section: 'Developer Reference',
    title: "Settings schema reference",
    description: "This page enumerates every settings field, its type, default, range (if applicable), and the JSON path you would use with manage_settings → patch_*_setting.",
  },
  'developer-sprint-format': {
    id: 'developer-sprint-format',
    path: '/docs/developer-sprint-format',
    section: 'Developer Reference',
    title: "Sprint and subtask file format",
    description: "Code UX sprints are stored both in a database and as on-disk markdown files. The markdown form is the portable, human-editable, source-of-truth representation. Importing/exporting a sprint round-trips through these fi...",
  },
  'developer-building-from-source': {
    id: 'developer-building-from-source',
    path: '/docs/developer-building-from-source',
    section: 'Developer Reference',
    title: "Building from source",
    description: "Code UX is a TypeScript monorepo with a server (src/), a Preact dashboard (dashboard/), and an extensive test suite (tests/).",
  },
  'developer-testing': {
    id: 'developer-testing',
    path: '/docs/developer-testing',
    section: 'Developer Reference',
    title: "Testing & quality gates",
    description: "Code UX uses Vitest as its single test runner across server and dashboard. CI gates enforce coverage thresholds and a full clean build.",
  },
  'developer-orchestration-debugging': {
    id: 'developer-orchestration-debugging',
    path: '/docs/developer-orchestration-debugging',
    section: 'Developer Reference',
    title: "Rapid orchestration debugging suite",
    description: "Use this suite when a sprint stalls, local merges fail, worker-owned attention items churn, or memory usage needs extended observation after a fix. CI runs the Linux Docker and macOS/Windows Electron QA DAG rows on bo...",
  },
  'architecture-overview': {
    id: 'architecture-overview',
    path: '/docs/architecture-overview',
    section: 'Architecture',
    title: "Architecture",
    description: "This section documents the internals of Code UX — the engine, the data model, the runtime topology, and the design trade-offs behind each.",
  },
  'architecture-system-overview': {
    id: 'architecture-system-overview',
    path: '/docs/architecture-system-overview',
    section: 'Architecture',
    title: "System overview",
    description: "Code UX is a single Node process that hosts multiple cooperating services. This page describes that process model, the major services, and how data flows through them.",
  },
  'architecture-mcp-server': {
    id: 'architecture-mcp-server',
    path: '/docs/architecture-mcp-server',
    section: 'Architecture',
    title: "MCP server internals",
    description: "The MCP server is the protocol-level interface between MCP clients (Gemini CLI, Codex CLI, Claude Desktop, custom integrations) and Code UX's services.",
  },
  'architecture-sprint-engine': {
    id: 'architecture-sprint-engine',
    path: '/docs/architecture-sprint-engine',
    section: 'Architecture',
    title: "Sprint engine",
    description: "The sprint engine is the heart of Code UX. It schedules, dispatches, monitors, gates, and finalises every unit of work.",
  },
  'architecture-virtual-workers': {
    id: 'architecture-virtual-workers',
    path: '/docs/architecture-virtual-workers',
    section: 'Architecture',
    title: "Virtual workers",
    description: "A virtual worker is an ephemeral, on-demand agent process that handles work outside the hosted Jules API — coding tasks, CI fixes, merge conflict resolution, and other attention items.",
  },
  'architecture-ci-integration': {
    id: 'architecture-ci-integration',
    path: '/docs/architecture-ci-integration',
    section: 'Architecture',
    title: "CI integration",
    description: "The CI gate is the bridge between Code UX's task graph and your real GitHub-based CI. It decides when each subtask's PR can be merged and how to react when CI is unhappy.",
  },
  'architecture-dashboard-architecture': {
    id: 'architecture-dashboard-architecture',
    path: '/docs/architecture-dashboard-architecture',
    section: 'Architecture',
    title: "Dashboard architecture",
    description: "The dashboard is a Preact + Vite + Tailwind v4 single-page application served by the Express dashboard server. It is the primary interface for humans operating Code UX.",
  },
  'architecture-data-model': {
    id: 'architecture-data-model',
    path: '/docs/architecture-data-model',
    section: 'Architecture',
    title: "Data model",
    description: "This page describes the entities Code UX persists and how they relate. The default backend is SQLite; a Postgres migration is planned but not yet shipped.",
  },
  'architecture-execution-invocation-tracking': {
    id: 'architecture-execution-invocation-tracking',
    path: '/docs/architecture-execution-invocation-tracking',
    section: 'Architecture',
    title: "Execution invocation tracking",
    description: "Code UX records provider work in execution_invocations and execution_invocation_messages so the dashboard can show prompt history, live agent transcripts, tool activity, token usage, and terminal status for each provi...",
  },
  'architecture-external-chat-providers': {
    id: 'architecture-external-chat-providers',
    path: '/docs/architecture-external-chat-providers',
    section: 'Architecture',
    title: "External chat connectors",
    description: "Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The runtime stays adapter-neutral: it records provider setup, bridge mode, channel ro...",
  },
  'architecture-configuration-resolution': {
    id: 'architecture-configuration-resolution',
    path: '/docs/architecture-configuration-resolution',
    section: 'Architecture',
    title: "Configuration resolution",
    description: "This page documents how Code UX assembles the effective configuration at runtime — combining CLI flags, environment variables, on-disk JSON files, and the database settings tree.",
  },
  'architecture-security': {
    id: 'architecture-security',
    path: '/docs/architecture-security',
    section: 'Architecture',
    title: "Security model",
    description: "Code UX is designed to run as a single-user trusted process on a developer's workstation or a dedicated server. This page documents what is and is not protected, the threat model, and the recommended deployment posture.",
  },
  'operations-credential-security': {
    id: 'operations-credential-security',
    path: '/docs/operations-credential-security',
    section: 'User Guide',
    title: "Automation Credential Security",
    description: "Code UX resolves canonical node credential IDs and named project binding keys through the credential broker. Stored values are not exposed to nodes, dashboard reads, MCP payloads, agent context, run inspection records...",
  },
  'operations-runbook': {
    id: 'operations-runbook',
    path: '/docs/operations-runbook',
    section: 'User Guide',
    title: "Authenticated Automation Runbook",
    description: "Run recovery drills only against the approved local test project and mocked job/email providers.",
  },
  'operations-security-hardening': {
    id: 'operations-security-hardening',
    path: '/docs/operations-security-hardening',
    section: 'User Guide',
    title: "Headless Security Hardening",
    description: "Remote dashboard/API access requires a service-token or trusted OIDC reverse-proxy boundary, TLS, project-scoped roles, and request correlation. A non-loopback DASHBOARD_HOST does not make credential routes public: ca...",
  },
  'operations-server-mode': {
    id: 'operations-server-mode',
    path: '/docs/operations-server-mode',
    section: 'User Guide',
    title: "Authenticated Headless Server Mode",
    description: "Code UX separates MCP bearer access from the authenticated dashboard administrative API. Remote dashboard/API deployments must use digest-backed service identities or terminate OIDC at a trusted reverse proxy; loopbac...",
  },
  'settings-google-drive-mount': {
    id: 'settings-google-drive-mount',
    path: '/docs/settings-google-drive-mount',
    section: 'User Guide',
    title: "Google Drive Project Mount",
    description: "The Google Drive project mount makes an existing local Google Drive sync or mount directory available to Docker-backed provider runs. Code UX does not connect to the Google Drive API, manage Google credentials, or syn...",
  },
  'user-dashboard-custom-dashboards': {
    id: 'user-dashboard-custom-dashboards',
    path: '/docs/user-dashboard-custom-dashboards',
    section: 'User Guide',
    title: "Custom Dashboards",
    description: "Custom dashboards are project-scoped dashboard apps generated and revised by agents, then validated in a detached Docker runtime before publication. Use them when the built-in dashboard pages do not match the operatio...",
  },
  'architecture-card-ci-status-projection': {
    id: 'architecture-card-ci-status-projection',
    path: '/docs/architecture-card-ci-status-projection',
    section: 'Architecture',
    title: "Card CI Status Projection",
    description: "Task, Sprint, and Live cards expose one compact persisted ciStatus: pending, running, failed, or null after settlement. The projection does not load the large remote Git status snapshot and does not poll GitHub or Git...",
  },
  'architecture-custom-dashboard-foundation': {
    id: 'architecture-custom-dashboard-foundation',
    path: '/docs/architecture-custom-dashboard-foundation',
    section: 'Architecture',
    title: "Custom Dashboard Foundation",
    description: "Custom dashboards are a persisted domain model for project-scoped dashboard generation. The foundation stores manifests, generated file bundles, data-source node graphs, validation history, and publication state, and...",
  },
  'architecture-custom-nodes': {
    id: 'architecture-custom-nodes',
    path: '/docs/architecture-custom-nodes',
    section: 'Architecture',
    title: "Custom Node Architecture and Security",
    description: "Custom nodes are project-owned TypeScript packages that pass explicit validation and publication gates before Code UX can execute them. Generated code is never imported or evaluated by the Code UX server.",
  },
  'architecture-dashboard-internationalization': {
    id: 'architecture-dashboard-internationalization',
    path: '/docs/architecture-dashboard-internationalization',
    section: 'Architecture',
    title: "Dashboard internationalization",
    description: "The v2 dashboard includes a dependency-free internationalization foundation for English (en) and German (de). English is the compatibility default, and the dashboard does not infer a locale from browser preferences.",
  },
  'architecture-managed-container-runtime': {
    id: 'architecture-managed-container-runtime',
    path: '/docs/architecture-managed-container-runtime',
    section: 'Architecture',
    title: "Managed Container Runtime",
    description: "The managed container runtime removes first-invocation Docker builds while keeping provider binaries local to each user's Docker host.",
  },
  'architecture-node-flow-builtins-and-security': {
    id: 'architecture-node-flow-builtins-and-security',
    path: '/docs/architecture-node-flow-builtins-and-security',
    section: 'Architecture',
    title: "Node Flow Built-ins and External-Effect Security",
    description: "The governed catalog adds deterministic branches, bounded collection processing, durable approvals, and replay-safe external effects while keeping the versioned definition registry as the executable authority.",
  },
  'architecture-node-flow-durable-execution': {
    id: 'architecture-node-flow-durable-execution',
    path: '/docs/architecture-node-flow-durable-execution',
    section: 'Architecture',
    title: "Node Flow Durable Execution",
    description: "Node flows execute immutable published snapshots. A run explicitly pins a published version or follows the latest published version; later edits cannot change a pinned run.",
  },
  'architecture-node-flow-foundation': {
    id: 'architecture-node-flow-foundation',
    path: '/docs/architecture-node-flow-foundation',
    section: 'Architecture',
    title: "Node Flow Foundation",
    description: "Code UX uses one project-owned Graph v2 contract across the dashboard, backend, MCP surface, scheduler, and runtime. Graphs carry schemaVersion: 2, stable versioned definition references, typed ports and flow schemas,...",
  },
  'architecture-node-flows': {
    id: 'architecture-node-flows',
    path: '/docs/architecture-node-flows',
    section: 'Architecture',
    title: "Node Flows",
    description: "Node flows are project-owned, versioned Graph v2 workflows.",
  },
  'architecture-speech-input': {
    id: 'architecture-speech-input',
    path: '/docs/architecture-speech-input',
    section: 'Architecture',
    title: "Speech Input Architecture",
    description: "Speech input turns dashboard microphone or uploaded audio into prompt text through POST /api/speech/transcriptions. Install and activate local models, or configure the API variant, under Settings -&gt; AI Models.",
  },
  'architecture-speech-output': {
    id: 'architecture-speech-output',
    path: '/docs/architecture-speech-output',
    section: 'Architecture',
    title: "Speech Output Architecture",
    description: "Speech output turns project-manager replies into audio through POST /api/speech/synthesis. Code UX supports local ONNX synthesis and OpenAI-compatible TTS APIs, and 3D Chat provides playback plus a voice on/off control.",
  },
  'architecture-sprint-rollbacks': {
    id: 'architecture-sprint-rollbacks',
    path: '/docs/architecture-sprint-rollbacks',
    section: 'Architecture',
    title: "Sprint Rollbacks",
    description: "Code UX models a rollback as a new sprint, not as destructive history editing. The original sprint remains auditable, while the rollback receives its own branch, tasks, execution history, and visual identity. Remote p...",
  },
  'architecture-worker-clarification-contract': {
    id: 'architecture-worker-clarification-contract',
    path: '/docs/architecture-worker-clarification-contract',
    section: 'Architecture',
    title: "Worker clarification contract",
    description: "Worker clarification requests use the existing project attention ledger as their durable store. They do not create a parallel table.",
  },
}

export const orderedDocs: DocsRegistryEntry[] = [
  docsRegistry['docs-overview'],
  docsRegistry['user-introduction'],
  docsRegistry['user-installation'],
  docsRegistry['user-quickstart'],
  docsRegistry['user-overview'],
  docsRegistry['user-mcp-clients'],
  docsRegistry['user-sprint-orchestration'],
  docsRegistry['user-providers-and-models'],
  docsRegistry['user-automation-and-ci'],
  docsRegistry['user-quicksprints'],
  docsRegistry['user-troubleshooting'],
  docsRegistry['user-dashboard-overview'],
  docsRegistry['user-dashboard-internationalization'],
  docsRegistry['user-dashboard-projects'],
  docsRegistry['user-dashboard-sprints'],
  docsRegistry['user-dashboard-tasks'],
  docsRegistry['user-dashboard-live-session'],
  docsRegistry['user-dashboard-chat'],
  docsRegistry['user-dashboard-agents'],
  docsRegistry['user-dashboard-nodes'],
  docsRegistry['user-dashboard-nodes-canvas'],
  docsRegistry['user-dashboard-node-flows'],
  docsRegistry['user-dashboard-scheduler'],
  docsRegistry['user-dashboard-memory'],
  docsRegistry['user-dashboard-knowledge'],
  docsRegistry['user-dashboard-file-browser'],
  docsRegistry['user-dashboard-browser-preview'],
  docsRegistry['user-dashboard-stats'],
  docsRegistry['user-dashboard-settings'],
  docsRegistry['user-dashboard-styleguides-and-tech-stacks'],
  docsRegistry['settings-overview'],
  docsRegistry['settings-project-context'],
  docsRegistry['settings-automation'],
  docsRegistry['settings-docker-runtime'],
  docsRegistry['settings-system-runtime'],
  docsRegistry['settings-restart-behavior'],
  docsRegistry['settings-database-settings'],
  docsRegistry['settings-onboarding'],
  docsRegistry['settings-display-settings'],
  docsRegistry['settings-background'],
  docsRegistry['settings-default-routing-anchors'],
  docsRegistry['settings-base-provider-configuration'],
  docsRegistry['settings-route-mapping'],
  docsRegistry['settings-model-pricing'],
  docsRegistry['settings-git-flow'],
  docsRegistry['settings-merge-gates-autofix'],
  docsRegistry['settings-quality-assurance'],
  docsRegistry['settings-guardrails'],
  docsRegistry['settings-rate-limit'],
  docsRegistry['settings-watch-loop'],
  docsRegistry['settings-workspace-hygiene'],
  docsRegistry['settings-workspace-visibility'],
  docsRegistry['settings-runtime-limits'],
  docsRegistry['settings-techstacks'],
  docsRegistry['settings-guidance'],
  docsRegistry['settings-project-markdown-mirror'],
  docsRegistry['settings-agent-routing'],
  docsRegistry['settings-memory-system'],
  docsRegistry['settings-long-term-remediation-schedule'],
  docsRegistry['settings-limits'],
  docsRegistry['settings-embedding-provider'],
  docsRegistry['settings-worker-learnings-instruction'],
  docsRegistry['settings-integrations'],
  docsRegistry['settings-jules-automation'],
  docsRegistry['settings-git-host-configuration'],
  docsRegistry['settings-jira-configuration'],
  docsRegistry['settings-importer-configuration'],
  docsRegistry['settings-provider-integration'],
  docsRegistry['settings-provider-credentials'],
  docsRegistry['settings-mcp-servers'],
  docsRegistry['settings-built-in-mcp'],
  docsRegistry['settings-mcp-tool-category'],
  docsRegistry['settings-custom-mcp-server'],
  docsRegistry['settings-danger-zone'],
  docsRegistry['settings-project-memory'],
  docsRegistry['settings-system-memory'],
  docsRegistry['settings-system-database'],
  docsRegistry['developer-overview'],
  docsRegistry['developer-mcp-tools'],
  docsRegistry['developer-management-actions'],
  docsRegistry['developer-http-api'],
  docsRegistry['developer-websocket-realtime'],
  docsRegistry['developer-configuration'],
  docsRegistry['developer-feature-flags'],
  docsRegistry['developer-settings-reference'],
  docsRegistry['developer-sprint-format'],
  docsRegistry['developer-building-from-source'],
  docsRegistry['developer-testing'],
  docsRegistry['developer-orchestration-debugging'],
  docsRegistry['architecture-overview'],
  docsRegistry['architecture-system-overview'],
  docsRegistry['architecture-mcp-server'],
  docsRegistry['architecture-sprint-engine'],
  docsRegistry['architecture-virtual-workers'],
  docsRegistry['architecture-ci-integration'],
  docsRegistry['architecture-dashboard-architecture'],
  docsRegistry['architecture-data-model'],
  docsRegistry['architecture-execution-invocation-tracking'],
  docsRegistry['architecture-external-chat-providers'],
  docsRegistry['architecture-configuration-resolution'],
  docsRegistry['architecture-security'],
  docsRegistry['operations-credential-security'],
  docsRegistry['operations-runbook'],
  docsRegistry['operations-security-hardening'],
  docsRegistry['operations-server-mode'],
  docsRegistry['settings-google-drive-mount'],
  docsRegistry['user-dashboard-custom-dashboards'],
  docsRegistry['architecture-card-ci-status-projection'],
  docsRegistry['architecture-custom-dashboard-foundation'],
  docsRegistry['architecture-custom-nodes'],
  docsRegistry['architecture-dashboard-internationalization'],
  docsRegistry['architecture-managed-container-runtime'],
  docsRegistry['architecture-node-flow-builtins-and-security'],
  docsRegistry['architecture-node-flow-durable-execution'],
  docsRegistry['architecture-node-flow-foundation'],
  docsRegistry['architecture-node-flows'],
  docsRegistry['architecture-speech-input'],
  docsRegistry['architecture-speech-output'],
  docsRegistry['architecture-sprint-rollbacks'],
  docsRegistry['architecture-worker-clarification-contract'],
]

export const groupedDocs = orderedDocs.reduce<Record<DocsSection, DocsRegistryEntry[]>>(
  (acc, doc) => {
    if (!acc[doc.section]) {
      acc[doc.section] = []
    }
    acc[doc.section].push(doc)
    return acc
  },
  {} as Record<DocsSection, DocsRegistryEntry[]>
)
