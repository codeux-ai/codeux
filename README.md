# Code UX

**A containerized agentic runtime for professional software teams.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.33+-orange.svg)](https://pnpm.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Code UX is a local-first orchestration platform for running serious AI-assisted engineering work. It turns a feature, refactor, migration, QA pass, or CI repair into a managed sprint: planned, routed to the right agent provider, executed in isolated workspaces, tracked in a live dashboard, reviewed through Git and CI, and surfaced back to the developer with clear intervention points.

The vision is simple: **a token-efficient agentic runtime built around how professional programmers and agencies already work.** Code UX does not try to replace the tools developers love. It coordinates them. Jules, Claude Code, Codex CLI, Gemini CLI, Qwen Code, OpenCode, Antigravity CLI, MCP tools, GitHub, GitLab, Jira, Docker, and browser previews all become part of one governed runtime.

## Install

The recommended path is the desktop app. Download the latest installer for your platform from the project [GitHub Releases](https://github.com/codeux-ai/codeux/releases).

| Platform | Release artifact | Notes |
| --- | --- | --- |
| Windows | `.exe` installer | Assisted installer with license and beta notice screens. |
| macOS | `.dmg` | Choose Apple Silicon or Intel according to your Mac. |
| Linux | `.AppImage`, `.deb`, or other packaged target | Use AppImage for portable use or `.deb` for Debian/Ubuntu-style installs. |

After launch, Code UX opens its local dashboard, normally at:

```text
http://localhost:4444
```

Need to build or run from source? Jump to [Run From Source](#run-from-source).

## What Code UX Does

Code UX is an agentic desktop runtime with a full dashboard for projects, sprints, agents, settings, live execution, memory, telemetry, Git state, and browser previews.

At a high level, Code UX:

- Creates and manages projects backed by local Git repositories.
- Plans sprints from natural-language goals, linked issues, or reusable quicksprint templates.
- Breaks work into dependency-aware tasks and runs ready tasks in parallel.
- Routes each invocation to the best configured provider, model, and agent preset.
- Centralizes agent presets and MCP tool configuration so provider CLIs inherit one shared project setup.
- Can generate specialized project agents automatically during project setup.
- Runs provider sessions in Docker-backed workspaces by default for repeatability and isolation.
- Opens and watches PRs/MRs, gates merges on CI, retries repair flows, and escalates when a human decision is needed.
- Captures runtime events, provider usage, token/time statistics, memory, logs, and sprint status in a real-time dashboard.
- Starts isolated Live Browser preview containers so UI work can be inspected from inside Code UX.

## Why It Exists

Most current agentic coding tools try to be a single autonomous agent for everything. They push more context into longer conversations, ask a model to reason through every operational step, and burn tokens on work that should be deterministic: branch setup, dependency ordering, merge checks, CI polling, PR state, reruns, conflict detection, and status bookkeeping.

Code UX takes the opposite path. It keeps the coding path predictable and moves the repetitive operational work into software. The runtime plans work as a dependency-aware DAG, starts only the tasks that are ready, tracks each execution in durable state, watches Git and CI programmatically, and automates merge gates wherever policy allows. Agents spend their tokens on the parts that actually need judgment: planning, implementation, review, repair, and conflict resolution.

That difference matters at professional scale:

- Large goals become atomic subtasks with explicit dependencies instead of one enormous prompt thread.
- Multiple tasks can run in parallel inside the same sprint without losing merge discipline.
- Multiple sprints can advance inside the same project because Code UX understands branch state, task state, PR state, and dependency state separately.
- Multiple projects can run side by side because execution is containerized, isolated, and visible from one dashboard.
- Short-term sprint memory and long-term project memory keep only the relevant learnings in context instead of dragging every past agent conversation into every prompt.
- Short-lived worker containers isolate agent execution and are destroyed after runs, reducing long-lived access and keeping company workspaces easier to govern.
- CI failures, merge conflicts, PR gates, issue imports, sprint exports, and intervention states are handled by the runtime instead of repeatedly explained to a model.

For agencies and senior engineers, this turns AI coding from an ad hoc chat workflow into an operating system for delivery. Jira, GitHub, and GitLab issue imports let teams start from the project-management systems they already use. Sprint planning turns client requests and backlog items into executable work. Containerized workers keep repositories separate. Sprint-aware memory carries forward what matters without bloating every provider call. Live Browser previews make frontend progress inspectable without terminal juggling. The dashboard gives leads a way to supervise many moving parts without reading every token of every agent conversation.

Code UX is built for huge work: migrations, product features, cleanup waves, QA passes, and multi-branch delivery where one agent session is not enough. Its dispatch architecture is also the foundation for something larger: a real containerized agent cluster. The long-term direction is an agent runtime that feels less like an oversized chatbot and more like Kubernetes for Docker-backed coding workers: schedulable, observable, policy-driven, and efficient by design.

## Core Features

### Multi-provider agent routing

Route work across all supported providers and models. Each provider can be configured with weights, concurrency limits, thinking mode, model defaults, credentials, Docker auth mounting, and route-specific overrides.

| Provider | Runtime type | Typical role |
| --- | --- | --- |
| Jules | Hosted Jules Agent API | Hosted orchestration, planning, and task execution. |
| Gemini | Local Gemini CLI | Fast iteration, planning, and general coding tasks. |
| Codex | Local Codex CLI | High-quality implementation, CI repair, merge-conflict repair. |
| Claude Code | Local Claude Code CLI | Planning, reasoning-heavy coding, QA review, clarification handling. |
| Qwen Code | Local Qwen Code CLI | Local, private, or custom-endpoint coding workflows. |
| OpenCode | Local OpenCode CLI | Multi-model CLI routing, OpenRouter-style provider flexibility, custom endpoints. |
| Antigravity | Local Antigravity CLI | CLI routing for teams that use Antigravity in their development flow. |

Code UX brings the same centralized routing, agents, memory, and tool setup to the provider CLIs teams already use: Claude Code, Codex CLI, Gemini CLI, Qwen Code, OpenCode, and Antigravity CLI.

### Docker-first execution

The default runtime is containerized. Code UX executes CLI providers in Docker-backed workspaces using a shared, configurable runtime image and setup flow. This keeps agent runs isolated from the host while still allowing controlled access to repository checkouts, Git credentials, provider auth, and runtime caches.

Docker-backed execution provides:

- Hermetic task workspaces and snapshot-based QA reviews.
- Reusable runtime caches for package managers and provider CLIs.
- Auth-copy support for provider credentials such as `~/.codex`, `~/.claude`, `~/.gemini`, `~/.qwen`, and OpenCode auth.
- Short-lived execution containers that are cleaned up after runs instead of becoming permanent agent environments.
- Isolated merge-conflict repair and CI autofix flows.
- Startup cleanup for stale containers, workspaces, and preview sessions.
 
Host execution is available for provider CLIs when speed or local tooling access is more important than isolation.

### Security by deterministic isolation

Code UX is designed for company environments where agent execution must be understandable, bounded, and auditable. The runtime avoids handing an autonomous agent an open-ended workspace and hoping it behaves correctly. Instead, Code UX keeps the workflow deterministic: tasks are dispatched through known routes, dependencies are explicit, merge rules are enforced by policy, CI state is checked programmatically, and human intervention points are surfaced when the runtime cannot safely proceed.

The container model strengthens that control. Provider CLIs run in short-lived Docker workspaces by default, scoped to the task or repair flow they are handling. After the run, Code UX captures the resulting patch, memory learnings, logs, and execution state, then cleans up the worker environment. Credentials can be mounted deliberately, caches can be shared without exposing full host state, and stale containers are pruned on startup.

For teams, this creates a stronger security posture than persistent, all-purpose agent sandboxes:

- Agent access is scoped to the current project, sprint, task, and provider route.
- Containers reduce direct exposure of the developer's host machine and unrelated repositories.
- Merge conflict repair, CI autofix, and QA review can run in isolated workspaces instead of mutating the main checkout directly.
- Structured execution records, logs, and correlation IDs make agent work reviewable after the fact.
- Deterministic Git and CI gates keep sensitive delivery decisions in the runtime instead of inside a model's private chain of reasoning.

### Live Browser preview containers

Code UX can start one preview container per sprint and render the running app inside the dashboard. Preview sessions are isolated by project and sprint, receive their own local origin, proxy HTTP and websocket traffic, and can be rebuilt as tasks complete.

The Browser page supports:

- Starting, stopping, rebuilding, and opening preview sessions.
- Per-sprint preview startup scripts.
- Auto-start when a sprint starts running.
- Rebuilds when task completion changes.
- Preview logs and port mapping visibility.
- Same-origin app previews for SPAs, APIs, cookies, local storage, and websocket clients.

### Sprint orchestration

Sprints are database-backed and can also round-trip through markdown for portable, reviewable task definitions. The orchestrator understands task dependencies, branch preparation, provider assignment, worker attention, CI gates, QA state, merge state, and terminal sprint outcomes.

Important sprint capabilities include:

- AI planning from a prompt, imported issues, or quicksprint templates.
- Dependency-aware DAG scheduling.
- Parallel task dispatch with provider-specific concurrency.
- Planning prompt improvement before task generation.
- Pause, resume, cancel, rerun, edit, force-complete, and human-intervention controls.
- GitHub, GitLab, and Jira issue import support.
- Sprint export back to markdown.

### Sprint-aware memory

Code UX treats memory as part of the runtime, not as an ever-growing prompt dump. It separates short-term sprint memory from long-term project memory so agents can learn from completed work without carrying irrelevant history into every task.

The memory architecture is designed for token efficiency:

- Sprint memory captures local decisions, fixes, constraints, and learnings that matter while a sprint is active.
- Project memory preserves durable knowledge that should survive across sprints.
- Planning, coding, QA, CI repair, and merge-conflict prompts can receive scoped memory instead of a full transcript.
- Memory inspection in the dashboard lets operators see what the runtime has learned and where that context came from.

This keeps context focused: a worker fixing a CI failure gets the relevant sprint and project learnings, not a noisy archive of unrelated conversations.

### Professional dashboard

The dashboard is a real-time Preact interface served locally by the backend and packaged inside the desktop app. It is designed for active operation, not passive reporting.

Main surfaces include:

- **Overview**: cross-project status, active runs, telemetry, and runtime health.
- **Projects**: local and Git URL project creation, setup-agent initialization, project selection, and repository metadata.
- **Sprints**: sprint composer, quicksprint templates, imported issues, live controls, status ledger, gallery, filters, and exports.
- **Tasks**: task creation, dependency editing, board/list views, and sprint-scoped task management.
- **Live Session**: active execution timeline, task cards, attention items, Git/CI/PR panels, and protocol guidance.
- **Agents**: project agent presets, markdown sync, routing hints, and reusable instructions.
- **Chat**: provider-backed project conversations and dashboard replies.
- **Scheduler**: scheduled sprints, quicksprints, and project messages with recurrence support.
- **File Browser**: project file inspection and repository navigation from the dashboard.
- **Memory**: short-term and long-term agent memory inspection.
- **Stats**: token, time, provider, purpose, task, and sprint analytics.
- **Settings**: scoped system/project/sprint configuration, provider setup, route mapping, Git integrations, Docker controls, appearance, scheduler, and browser preview settings.
- **Browser**: embedded sprint preview containers with logs, controls, and editable startup scripts.

### Git, CI, and agency workflow support

Code UX is built around existing professional delivery mechanics:

- Feature branch preparation and remote synchronization.
- GitHub and GitLab PR/MR discovery, creation, and status tracking.
- CI status polling and merge gates.
- Automated CI repair attempts through the selected provider.
- Merge-conflict handling in isolated workspaces.
- Jira, GitHub, and GitLab issue import and linked-issue closure options.
- Structured logs and correlation IDs across dashboard, provider, and execution paths.

### Centralized MCP and agent setup

Code UX gives teams one place to configure the tools and agents used by all their favorite coding CLIs. Instead of maintaining separate agent files, MCP tool connections, and setup instructions for every provider, Code UX centralizes that configuration at the system, project, and sprint level.

MCP support is provider-wide:

- Add an external MCP tool server once in Code UX, for example Playwright.
- Code UX makes it available to the configured provider CLIs inside their containers.
- Gemini, Codex, Claude Code, Qwen Code, OpenCode, and Antigravity CLI can receive the same tool surface without hand-configuring each CLI separately.
- Containerized runs get the same project MCP setup as host runs, while still keeping execution scoped to the active project and task.

Agent setup works the same way. Project agent presets live in Code UX, can be edited from the dashboard, synced to project markdown, and routed per invocation type. A team can define a planning agent, implementation agent, QA agent, CI repair agent, merge-conflict agent, and project-specific specialists once, then reuse them across all supported provider CLIs.

For new repositories, the Project Setup Agent can bootstrap a tailored set of specialized agents, quicksprint templates, preview scripts, and CI guidance. That makes project onboarding much faster: add the repository, let Code UX inspect the project, generate the right operating structure, and start planning sprint work without rebuilding the same agent setup for every CLI.

## Typical Workflow

1. Install Code UX from Releases and open the dashboard.
2. Add a local repository or clone a Git URL into a managed project.
3. Configure provider credentials and choose Docker or host execution for each provider.
4. Create a sprint from a prompt, linked issue set, or quicksprint template.
5. Let the planning agent generate dependency-aware tasks.
6. Start orchestration and follow the Live Session page.
7. Inspect preview containers, task output, PR/CI state, and attention items.
8. Let Code UX merge completed work according to your policy, or take over manually when the protocol requires it.

## Documentation

- [Documentation index](./docs/index.md)
- [User quickstart](./docs-web/user/quickstart.md)
- [Providers and models](./docs-web/user/providers-and-models.md)
- [Dashboard guide](./docs/dashboard/dashboard-guide.md)
- [Sprint preview browser](./docs/architecture/sprint-preview-browser.md)
- [Configuration](./docs-web/developer/configuration.md)
- [Building from source](./docs-web/developer/building-from-source.md)

## Run From Source

Use source builds when developing Code UX itself or when you need to inspect/modify the runtime.

### Requirements

- Node.js 22 LTS or newer.
- pnpm 10.33 or newer.
- Git 2.30 or newer.
- Docker, recommended for virtual worker execution and required for preview containers.
- Provider credentials are optional for installation and local startup; configure them later in the dashboard when you are ready to dispatch work.

### Clone and install

```bash
git clone https://github.com/codeux-ai/codeux.git
cd codeux
pnpm install
```

### Configure providers

You can start Code UX without API keys or environment variables. When you are ready to run agent work, configure providers from the dashboard. For local CLI providers, authenticate with the provider's normal CLI login flow; Code UX can detect and optionally mount local auth for Gemini, Codex, Claude Code, Qwen Code, OpenCode, and Antigravity CLI.

### Run in development

```bash
pnpm run dev
```

Then open:

```text
http://localhost:4444
```

### Build and run

```bash
pnpm run build
pnpm start
```

### Validate locally

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

For the full local CI equivalent:

```bash
pnpm run ci
```

GitHub Actions also runs the high-severity dependency audit after the consolidated CI command:

```bash
pnpm run audit
```

## License

Code UX is released under the [MIT License](./LICENSE).
