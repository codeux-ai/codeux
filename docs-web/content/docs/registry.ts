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
  | 'user-dashboard-projects'
  | 'user-dashboard-sprints'
  | 'user-dashboard-tasks'
  | 'user-dashboard-live-session'
  | 'user-dashboard-chat'
  | 'user-dashboard-agents'
  | 'user-dashboard-scheduler'
  | 'user-dashboard-memory'
  | 'user-dashboard-knowledge'
  | 'user-dashboard-file-browser'
  | 'user-dashboard-browser-preview'
  | 'user-dashboard-stats'
  | 'user-dashboard-settings'
  | 'developer-overview'
  | 'developer-mcp-tools'
  | 'developer-management-actions'
  | 'developer-http-api'
  | 'developer-websocket-realtime'
  | 'developer-configuration'
  | 'developer-settings-reference'
  | 'developer-sprint-format'
  | 'developer-building-from-source'
  | 'developer-testing'
  | 'architecture-overview'
  | 'architecture-system-overview'
  | 'architecture-mcp-server'
  | 'architecture-sprint-engine'
  | 'architecture-virtual-workers'
  | 'architecture-ci-integration'
  | 'architecture-dashboard-architecture'
  | 'architecture-data-model'
  | 'architecture-configuration-resolution'
  | 'architecture-security'
  | 'settings-configuration-and-storage'
  | 'settings-opencode-integration'
  | 'settings-provider-routing'
  | 'settings-qwen-code-integration'
  | 'settings-subcategories-agent-routing'
  | 'settings-subcategories-automation'
  | 'settings-subcategories-background'
  | 'settings-subcategories-base-provider-configuration'
  | 'settings-subcategories-built-in-mcp'
  | 'settings-subcategories-custom-mcp-server'
  | 'settings-subcategories-danger-zone'
  | 'settings-subcategories-database-settings'
  | 'settings-subcategories-default-routing-anchors'
  | 'settings-subcategories-display-settings'
  | 'settings-subcategories-docker-runtime'
  | 'settings-subcategories-embedding-provider'
  | 'settings-subcategories-git-flow'
  | 'settings-subcategories-git-host-configuration'
  | 'settings-subcategories-guardrails'
  | 'settings-subcategories-importer-configuration'
  | 'settings-subcategories-overview'
  | 'settings-subcategories-integrations'
  | 'settings-subcategories-jira-configuration'
  | 'settings-subcategories-jules-automation'
  | 'settings-subcategories-limits'
  | 'settings-subcategories-long-term-remediation-schedule'
  | 'settings-subcategories-mcp-servers'
  | 'settings-subcategories-mcp-tool-category'
  | 'settings-subcategories-memory-system'
  | 'settings-subcategories-merge-gates-autofix'
  | 'settings-subcategories-model-pricing'
  | 'settings-subcategories-onboarding'
  | 'settings-subcategories-project-context'
  | 'settings-subcategories-project-markdown-mirror'
  | 'settings-subcategories-project-memory'
  | 'settings-subcategories-provider-credentials'
  | 'settings-subcategories-provider-integration'
  | 'settings-subcategories-quality-assurance'
  | 'settings-subcategories-rate-limit'
  | 'settings-subcategories-restart-behavior'
  | 'settings-subcategories-route-mapping'
  | 'settings-subcategories-runtime-limits'
  | 'settings-subcategories-system-database'
  | 'settings-subcategories-system-memory'
  | 'settings-subcategories-system-runtime'
  | 'settings-subcategories-techstacks'
  | 'settings-subcategories-watch-loop'
  | 'settings-subcategories-worker-learnings-instruction'
  | 'settings-subcategories-workspace-hygiene'
  | 'settings-subcategories-workspace-visibility'

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
  'user-dashboard-projects': {
    id: 'user-dashboard-projects',
    path: '/docs/user-dashboard-projects',
    section: 'User Guide',
    title: "Projects",
    description: "The Projects page (/projects) lists every project Code UX manages and lets you create, edit, select, and delete them. Each card now surfaces the source badge, repository URL, local workspace directory, creation and up...",
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
    description: "The Chat page (/chat) is a conversation surface that lets you talk to agents for project-backed Q&A, inspect MCP tool invocations, and get local onboarding help before any project exists.",
  },
  'user-dashboard-agents': {
    id: 'user-dashboard-agents',
    path: '/docs/user-dashboard-agents',
    section: 'User Guide',
    title: "Agents",
    description: "The Agents page (/agents) manages the agent presets available to the active project.",
  },
  'user-dashboard-scheduler': {
    id: 'user-dashboard-scheduler',
    path: '/docs/user-dashboard-scheduler',
    section: 'User Guide',
    title: "Scheduler",
    description: "The Scheduler page (dock label Schedule, /scheduler) runs Code UX work on a timetable. Schedule a sprint, a quicksprint template, a project message, or memory remediation to fire once or on a recurring cadence — usefu...",
  },
  'user-dashboard-memory': {
    id: 'user-dashboard-memory',
    path: '/docs/user-dashboard-memory',
    section: 'User Guide',
    title: "Memory",
    description: "The Memory page (/memory) manages Code UX's two-tier semantic memory system and the embedding models that power it.",
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
    description: "The Stats page (/stats) is the analytics surface for the active project. It shows project execution, usage, cost, Git, and invocation telemetry in one workspace with visual-mode navigation, responsive layouts, and lig...",
  },
  'user-dashboard-settings': {
    id: 'user-dashboard-settings',
    path: '/docs/user-dashboard-settings',
    section: 'User Guide',
    title: "Settings",
    description: "The Settings page (/config) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.",
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
    description: "Code UX is also an MCP server. When connected, it advertises a set of management tools that an MCP client (or another agent) can call to drive projects, sprints, tasks, agents, memory, persistent skills, settings, pre...",
  },
  'developer-management-actions': {
    id: 'developer-management-actions',
    path: '/docs/developer-management-actions',
    section: 'Developer Reference',
    title: "Management actions",
    description: "Code UX exposes grouped MCP tools per management domain — manage_projects, manage_sprints, manage_tasks, manage_quicksprints, manage_scheduler, manage_agents, manage_memory, search_knowledge, manage_settings, manage_p...",
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
  'settings-configuration-and-storage': {
    id: 'settings-configuration-and-storage',
    path: '/docs/settings-configuration-and-storage',
    section: 'User Guide',
    title: "Configuration and Storage",
    description: "This guide explains runtime config sources, precedence, and persistence.",
  },
  'settings-opencode-integration': {
    id: 'settings-opencode-integration',
    path: '/docs/settings-opencode-integration',
    section: 'User Guide',
    title: "OpenCode Integration",
    description: "Code UX supports OpenCode as a first-class virtual CLI provider alongside Gemini, Codex, Claude Code, and Qwen Code.",
  },
  'settings-provider-routing': {
    id: 'settings-provider-routing',
    path: '/docs/settings-provider-routing',
    section: 'User Guide',
    title: "Provider Routing",
    description: "This page describes how Code UX resolves provider, model, and provider pool selection for each invocation type.",
  },
  'settings-qwen-code-integration': {
    id: 'settings-qwen-code-integration',
    path: '/docs/settings-qwen-code-integration',
    section: 'User Guide',
    title: "Qwen Code Integration",
    description: "Code UX supports Qwen Code as a first-class virtual CLI provider alongside Gemini, Codex, and Claude Code.",
  },
  'settings-subcategories-agent-routing': {
    id: 'settings-subcategories-agent-routing',
    path: '/docs/settings-subcategories-agent-routing',
    section: 'User Guide',
    title: "Agent Routing",
    description: "Assigns built-in or project agent presets to planning, coding, CI, merge, dashboard, and clarification work.",
  },
  'settings-subcategories-automation': {
    id: 'settings-subcategories-automation',
    path: '/docs/settings-subcategories-automation',
    section: 'User Guide',
    title: "Automation",
    description: "Controls how much Code UX may continue without pausing for operator decisions.",
  },
  'settings-subcategories-background': {
    id: 'settings-subcategories-background',
    path: '/docs/settings-subcategories-background',
    section: 'User Guide',
    title: "Background",
    description: "Customizes the dashboard background image, animation mode, static color, and pattern overlay.",
  },
  'settings-subcategories-base-provider-configuration': {
    id: 'settings-subcategories-base-provider-configuration',
    path: '/docs/settings-subcategories-base-provider-configuration',
    section: 'User Guide',
    title: "Base Provider Configuration",
    description: "Defines each named provider instance's default eligibility, model, thinking depth, weight, and concurrency.",
  },
  'settings-subcategories-built-in-mcp': {
    id: 'settings-subcategories-built-in-mcp',
    path: '/docs/settings-subcategories-built-in-mcp',
    section: 'User Guide',
    title: "Built-in MCP (Code UX)",
    description: "Controls which built-in Code UX MCP tool categories are available to containerized CLIs.",
  },
  'settings-subcategories-custom-mcp-server': {
    id: 'settings-subcategories-custom-mcp-server',
    path: '/docs/settings-subcategories-custom-mcp-server',
    section: 'User Guide',
    title: "Custom MCP Server",
    description: "Configures one custom MCP server injected into compatible provider CLIs.",
  },
  'settings-subcategories-danger-zone': {
    id: 'settings-subcategories-danger-zone',
    path: '/docs/settings-subcategories-danger-zone',
    section: 'User Guide',
    title: "Danger Zone",
    description: "Groups irreversible project deletion and project override reset actions.",
  },
  'settings-subcategories-database-settings': {
    id: 'settings-subcategories-database-settings',
    path: '/docs/settings-subcategories-database-settings',
    section: 'User Guide',
    title: "Database Settings",
    description: "Manages local SQLite retention and maintenance for runtime activity data.",
  },
  'settings-subcategories-default-routing-anchors': {
    id: 'settings-subcategories-default-routing-anchors',
    path: '/docs/settings-subcategories-default-routing-anchors',
    section: 'User Guide',
    title: "Default Routing Anchors",
    description: "Sets the global and worker provider instances used when invocation routes inherit defaults.",
  },
  'settings-subcategories-display-settings': {
    id: 'settings-subcategories-display-settings',
    path: '/docs/settings-subcategories-display-settings',
    section: 'User Guide',
    title: "Display Settings",
    description: "Controls the dashboard shell layout, experience mode, theme, motion preference, and desktop zoom when available.",
  },
  'settings-subcategories-docker-runtime': {
    id: 'settings-subcategories-docker-runtime',
    path: '/docs/settings-subcategories-docker-runtime',
    section: 'User Guide',
    title: "Docker Runtime",
    description: "Defines the default container environment used by Docker-backed provider CLIs.",
  },
  'settings-subcategories-embedding-provider': {
    id: 'settings-subcategories-embedding-provider',
    path: '/docs/settings-subcategories-embedding-provider',
    section: 'User Guide',
    title: "Embedding Provider",
    description: "Chooses in-app embeddings or an external OpenAI-compatible embeddings API.",
  },
  'settings-subcategories-git-flow': {
    id: 'settings-subcategories-git-flow',
    path: '/docs/settings-subcategories-git-flow',
    section: 'User Guide',
    title: "Git Flow",
    description: "Controls branch naming, PR creation, issue closure, and cleanup for sprint work.",
  },
  'settings-subcategories-git-host-configuration': {
    id: 'settings-subcategories-git-host-configuration',
    path: '/docs/settings-subcategories-git-host-configuration',
    section: 'User Guide',
    title: "Git Host Configuration",
    description: "Stores GitHub or GitLab tokens and Docker git-auth behavior for repository automation.",
  },
  'settings-subcategories-guardrails': {
    id: 'settings-subcategories-guardrails',
    path: '/docs/settings-subcategories-guardrails',
    section: 'User Guide',
    title: "Guardrails",
    description: "Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably.",
  },
  'settings-subcategories-importer-configuration': {
    id: 'settings-subcategories-importer-configuration',
    path: '/docs/settings-subcategories-importer-configuration',
    section: 'User Guide',
    title: "Importer Configuration",
    description: "Read-only import settings for Notion, Asana, Linear, Miro, Lucid/Lucidspark, Figma/FigJam, and Mural.",
  },
  'settings-subcategories-overview': {
    id: 'settings-subcategories-overview',
    path: '/docs/settings-subcategories-overview',
    section: 'User Guide',
    title: "Settings Subcategory Reference",
    description: "Every visible Settings subcategory card has card-level help and a documentation link. These pages are the canonical source for the detailed recommendations behind those links.",
  },
  'settings-subcategories-integrations': {
    id: 'settings-subcategories-integrations',
    path: '/docs/settings-subcategories-integrations',
    section: 'User Guide',
    title: "Integrations",
    description: "Lists provider, git-host, and issue-tracker integrations and exposes manage/add actions.",
  },
  'settings-subcategories-jira-configuration': {
    id: 'settings-subcategories-jira-configuration',
    path: '/docs/settings-subcategories-jira-configuration',
    section: 'User Guide',
    title: "Jira Configuration",
    description: "Connects Jira issue search, import transitions, and completion transitions.",
  },
  'settings-subcategories-jules-automation': {
    id: 'settings-subcategories-jules-automation',
    path: '/docs/settings-subcategories-jules-automation',
    section: 'User Guide',
    title: "Jules Automation",
    description: "Configures Jules clarification automation and CI autofix handoff behavior.",
  },
  'settings-subcategories-limits': {
    id: 'settings-subcategories-limits',
    path: '/docs/settings-subcategories-limits',
    section: 'User Guide',
    title: "Limits",
    description: "Caps memory promotion thresholds, retained memories, graph density, and remediation promotions.",
  },
  'settings-subcategories-long-term-remediation-schedule': {
    id: 'settings-subcategories-long-term-remediation-schedule',
    path: '/docs/settings-subcategories-long-term-remediation-schedule',
    section: 'User Guide',
    title: "Long-Term Remediation Schedule",
    description: "Schedules recurring project memory cleanup and claim maintenance.",
  },
  'settings-subcategories-mcp-servers': {
    id: 'settings-subcategories-mcp-servers',
    path: '/docs/settings-subcategories-mcp-servers',
    section: 'User Guide',
    title: "MCP Servers",
    description: "Lists built-in and custom MCP servers injected into provider CLI runtimes.",
  },
  'settings-subcategories-mcp-tool-category': {
    id: 'settings-subcategories-mcp-tool-category',
    path: '/docs/settings-subcategories-mcp-tool-category',
    section: 'User Guide',
    title: "MCP Tool Category",
    description: "Enables or disables one built-in MCP tool category and its individual tools.",
  },
  'settings-subcategories-memory-system': {
    id: 'settings-subcategories-memory-system',
    path: '/docs/settings-subcategories-memory-system',
    section: 'User Guide',
    title: "Memory System",
    description: "Controls capture, promotion, and remediation of sprint and project memory.",
  },
  'settings-subcategories-merge-gates-autofix': {
    id: 'settings-subcategories-merge-gates-autofix',
    path: '/docs/settings-subcategories-merge-gates-autofix',
    section: 'User Guide',
    title: "Merge Gates & Autofix",
    description: "Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges.",
  },
  'settings-subcategories-model-pricing': {
    id: 'settings-subcategories-model-pricing',
    path: '/docs/settings-subcategories-model-pricing',
    section: 'User Guide',
    title: "Model Pricing",
    description: "Stores token pricing metadata used for model cost estimates in dashboard views.",
  },
  'settings-subcategories-onboarding': {
    id: 'settings-subcategories-onboarding',
    path: '/docs/settings-subcategories-onboarding',
    section: 'User Guide',
    title: "Onboarding",
    description: "Reopens the guided setup flow without changing saved settings by itself.",
  },
  'settings-subcategories-project-context': {
    id: 'settings-subcategories-project-context',
    path: '/docs/settings-subcategories-project-context',
    section: 'User Guide',
    title: "Project Context",
    description: "Names and identifies the active project without changing the stored project id or execution history.",
  },
  'settings-subcategories-project-markdown-mirror': {
    id: 'settings-subcategories-project-markdown-mirror',
    path: '/docs/settings-subcategories-project-markdown-mirror',
    section: 'User Guide',
    title: "Project Markdown Mirror",
    description: "Controls whether dashboard-authored agent presets are mirrored into project-local markdown files.",
  },
  'settings-subcategories-project-memory': {
    id: 'settings-subcategories-project-memory',
    path: '/docs/settings-subcategories-project-memory',
    section: 'User Guide',
    title: "Project Memory",
    description: "Clears selected memory tiers for the active project only.",
  },
  'settings-subcategories-provider-credentials': {
    id: 'settings-subcategories-provider-credentials',
    path: '/docs/settings-subcategories-provider-credentials',
    section: 'User Guide',
    title: "Provider Credentials",
    description: "Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults.",
  },
  'settings-subcategories-provider-integration': {
    id: 'settings-subcategories-provider-integration',
    path: '/docs/settings-subcategories-provider-integration',
    section: 'User Guide',
    title: "Provider Integration",
    description: "Explains that provider credentials are system-owned while project scopes still control routing and auth-copy behavior.",
  },
  'settings-subcategories-quality-assurance': {
    id: 'settings-subcategories-quality-assurance',
    path: '/docs/settings-subcategories-quality-assurance',
    section: 'User Guide',
    title: "Quality Assurance",
    description: "Controls completion-time QA review, QA routing, and trigger-specific agent assignment.",
  },
  'settings-subcategories-rate-limit': {
    id: 'settings-subcategories-rate-limit',
    path: '/docs/settings-subcategories-rate-limit',
    section: 'User Guide',
    title: "Rate Limit",
    description: "Controls retries after provider quota or rate-limit responses.",
  },
  'settings-subcategories-restart-behavior': {
    id: 'settings-subcategories-restart-behavior',
    path: '/docs/settings-subcategories-restart-behavior',
    section: 'User Guide',
    title: "Restart Behavior",
    description: "Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts.",
  },
  'settings-subcategories-route-mapping': {
    id: 'settings-subcategories-route-mapping',
    path: '/docs/settings-subcategories-route-mapping',
    section: 'User Guide',
    title: "Route Mapping",
    description: "Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.",
  },
  'settings-subcategories-runtime-limits': {
    id: 'settings-subcategories-runtime-limits',
    path: '/docs/settings-subcategories-runtime-limits',
    section: 'User Guide',
    title: "Runtime Limits",
    description: "Sets preview container concurrency, host port range, app port, and startup script path.",
  },
  'settings-subcategories-system-database': {
    id: 'settings-subcategories-system-database',
    path: '/docs/settings-subcategories-system-database',
    section: 'User Guide',
    title: "System Database",
    description: "Wipes the local Code UX database so the app returns to a clean state on reload.",
  },
  'settings-subcategories-system-memory': {
    id: 'settings-subcategories-system-memory',
    path: '/docs/settings-subcategories-system-memory',
    section: 'User Guide',
    title: "System Memory",
    description: "Clears memory tiers across every project in the local database.",
  },
  'settings-subcategories-system-runtime': {
    id: 'settings-subcategories-system-runtime',
    path: '/docs/settings-subcategories-system-runtime',
    section: 'User Guide',
    title: "System Runtime",
    description: "Configures dashboard port and runtime logging behavior for the local Code UX process.",
  },
  'settings-subcategories-techstacks': {
    id: 'settings-subcategories-techstacks',
    path: '/docs/settings-subcategories-techstacks',
    section: 'User Guide',
    title: "Techstacks",
    description: "Manages the system techstack catalog and per-project techstack/application-kind assignment.",
  },
  'settings-subcategories-watch-loop': {
    id: 'settings-subcategories-watch-loop',
    path: '/docs/settings-subcategories-watch-loop',
    section: 'User Guide',
    title: "Watch Loop",
    description: "Controls whether live sprint orchestration keeps polling and how frequently it emits work.",
  },
  'settings-subcategories-worker-learnings-instruction': {
    id: 'settings-subcategories-worker-learnings-instruction',
    path: '/docs/settings-subcategories-worker-learnings-instruction',
    section: 'User Guide',
    title: "Worker Learnings Instruction",
    description: "Defines the prompt appended to worker tasks so useful lessons are captured for memory processing.",
  },
  'settings-subcategories-workspace-hygiene': {
    id: 'settings-subcategories-workspace-hygiene',
    path: '/docs/settings-subcategories-workspace-hygiene',
    section: 'User Guide',
    title: "Workspace Hygiene",
    description: "Controls cleanup of temporary worktree state after provider CLI runs.",
  },
  'settings-subcategories-workspace-visibility': {
    id: 'settings-subcategories-workspace-visibility',
    path: '/docs/settings-subcategories-workspace-visibility',
    section: 'User Guide',
    title: "Workspace Visibility",
    description: "Controls automatic preview lifecycle and whether browser workspace entry points appear in the dashboard.",
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
  docsRegistry['user-dashboard-projects'],
  docsRegistry['user-dashboard-sprints'],
  docsRegistry['user-dashboard-tasks'],
  docsRegistry['user-dashboard-live-session'],
  docsRegistry['user-dashboard-chat'],
  docsRegistry['user-dashboard-agents'],
  docsRegistry['user-dashboard-scheduler'],
  docsRegistry['user-dashboard-memory'],
  docsRegistry['user-dashboard-knowledge'],
  docsRegistry['user-dashboard-file-browser'],
  docsRegistry['user-dashboard-browser-preview'],
  docsRegistry['user-dashboard-stats'],
  docsRegistry['user-dashboard-settings'],
  docsRegistry['developer-overview'],
  docsRegistry['developer-mcp-tools'],
  docsRegistry['developer-management-actions'],
  docsRegistry['developer-http-api'],
  docsRegistry['developer-websocket-realtime'],
  docsRegistry['developer-configuration'],
  docsRegistry['developer-settings-reference'],
  docsRegistry['developer-sprint-format'],
  docsRegistry['developer-building-from-source'],
  docsRegistry['developer-testing'],
  docsRegistry['architecture-overview'],
  docsRegistry['architecture-system-overview'],
  docsRegistry['architecture-mcp-server'],
  docsRegistry['architecture-sprint-engine'],
  docsRegistry['architecture-virtual-workers'],
  docsRegistry['architecture-ci-integration'],
  docsRegistry['architecture-dashboard-architecture'],
  docsRegistry['architecture-data-model'],
  docsRegistry['architecture-configuration-resolution'],
  docsRegistry['architecture-security'],
  docsRegistry['settings-configuration-and-storage'],
  docsRegistry['settings-opencode-integration'],
  docsRegistry['settings-provider-routing'],
  docsRegistry['settings-qwen-code-integration'],
  docsRegistry['settings-subcategories-agent-routing'],
  docsRegistry['settings-subcategories-automation'],
  docsRegistry['settings-subcategories-background'],
  docsRegistry['settings-subcategories-base-provider-configuration'],
  docsRegistry['settings-subcategories-built-in-mcp'],
  docsRegistry['settings-subcategories-custom-mcp-server'],
  docsRegistry['settings-subcategories-danger-zone'],
  docsRegistry['settings-subcategories-database-settings'],
  docsRegistry['settings-subcategories-default-routing-anchors'],
  docsRegistry['settings-subcategories-display-settings'],
  docsRegistry['settings-subcategories-docker-runtime'],
  docsRegistry['settings-subcategories-embedding-provider'],
  docsRegistry['settings-subcategories-git-flow'],
  docsRegistry['settings-subcategories-git-host-configuration'],
  docsRegistry['settings-subcategories-guardrails'],
  docsRegistry['settings-subcategories-importer-configuration'],
  docsRegistry['settings-subcategories-overview'],
  docsRegistry['settings-subcategories-integrations'],
  docsRegistry['settings-subcategories-jira-configuration'],
  docsRegistry['settings-subcategories-jules-automation'],
  docsRegistry['settings-subcategories-limits'],
  docsRegistry['settings-subcategories-long-term-remediation-schedule'],
  docsRegistry['settings-subcategories-mcp-servers'],
  docsRegistry['settings-subcategories-mcp-tool-category'],
  docsRegistry['settings-subcategories-memory-system'],
  docsRegistry['settings-subcategories-merge-gates-autofix'],
  docsRegistry['settings-subcategories-model-pricing'],
  docsRegistry['settings-subcategories-onboarding'],
  docsRegistry['settings-subcategories-project-context'],
  docsRegistry['settings-subcategories-project-markdown-mirror'],
  docsRegistry['settings-subcategories-project-memory'],
  docsRegistry['settings-subcategories-provider-credentials'],
  docsRegistry['settings-subcategories-provider-integration'],
  docsRegistry['settings-subcategories-quality-assurance'],
  docsRegistry['settings-subcategories-rate-limit'],
  docsRegistry['settings-subcategories-restart-behavior'],
  docsRegistry['settings-subcategories-route-mapping'],
  docsRegistry['settings-subcategories-runtime-limits'],
  docsRegistry['settings-subcategories-system-database'],
  docsRegistry['settings-subcategories-system-memory'],
  docsRegistry['settings-subcategories-system-runtime'],
  docsRegistry['settings-subcategories-techstacks'],
  docsRegistry['settings-subcategories-watch-loop'],
  docsRegistry['settings-subcategories-worker-learnings-instruction'],
  docsRegistry['settings-subcategories-workspace-hygiene'],
  docsRegistry['settings-subcategories-workspace-visibility'],
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
