# GEMINI Context: Code UX

**Code UX** (`@codeuxai/codeux`, bin `codeux`) is a local-first, MIT-licensed, **container-first
agentic coding runtime**. It turns a feature/refactor/migration/QA/CI-repair goal into a managed
**sprint**: planned into a dependency-aware DAG, routed to a provider, executed in isolated Docker
workspaces, gated through Git/CI, and surfaced in a live Preact dashboard.

> Historical note: this began as a Jules MCP server. **Jules is now just one (hosted) provider** among
> several local CLI providers. Don't treat the codebase as Jules-specific.

---

## 🚀 1. Project Mission & Identity
Transform high-level natural-language goals into atomic, test-validated PRs by coordinating the
provider CLIs developers already use (Gemini, Codex, Claude Code, Qwen, OpenCode, Antigravity) plus
hosted Jules — each running in isolated Docker workspaces, with the repetitive operational work
(branching, dependency ordering, CI polling, merge gates, conflict repair) moved into deterministic
software instead of model reasoning.

The runtime ships three ways from one codebase: the **CLI/server** (`codeux`), an **Electron desktop
app**, and an **MCP server** (stdio + optional HTTPS worker gateway).

---

## 🛠️ 2. Core Technology Stack

### Backend (Node.js / ESM)
- **Runtime**: Node.js **22+** (strict ESM, `"type": "module"`, NodeNext resolution).
- **Package manager**: **pnpm** (`pnpm@10.33.0`) — use `pnpm`, not `npm`.
- **Language**: TypeScript 5.9 (strict, `ES2022` target).
- **Protocol**: Model Context Protocol via `@modelcontextprotocol/sdk`.
- **HTTP**: Express 5 for the dashboard/API; Axios for Jules + Jira REST.
- **Persistence**: **SQLite at `~/.code-ux/app.db`** (WAL) via Node's built-in `node:sqlite`
  (`DatabaseSync`) — no `sqlite3` CLI, no ORM.
- **Logging**: Structured logging with request correlation IDs.

### Frontend (Preact / Vite)
- **Framework**: Preact (React aliased to `preact/compat`). Current UI lives in `dashboard/src/v2/`.
- **Styling**: Tailwind CSS v4.
- **State**: `@preact/signals`.
- **Animation**: GSAP. **Icons**: Lucide.
- **Editor / extras**: Monaco (file browser), served on **`http://localhost:4444`**.

### Infrastructure & Isolation
- **Containerization**: Docker — provider CLIs run in short-lived, per-task workspaces by default;
  host execution is an opt-in fallback. Stale containers/workspaces/previews are pruned on startup.
- **Git**: programmatic branch prep, PR/MR discovery + creation, CI gates, isolated merge-conflict and
  CI-autofix repair. LOCAL git mode supports no-origin repos.
- **Previews**: one Live Browser container per sprint, proxied at `preview-<id>.localhost`.

---

## 🏗️ 3. Architectural Deep Dive

### A. MCP Layer (`src/mcp/`, `src/api/mcp/`, `src/contracts/mcp-tool-definitions.ts`)
Exposes ~12 grouped `manage_*` tools — `manage_code_ux`, `manage_projects`, `manage_sprints`,
`manage_tasks`, `manage_quicksprints`, `manage_scheduler`, `manage_agents`, `manage_memory`,
`search_knowledge`, `manage_settings`, `manage_preview`, `manage_telemetry` — over stdio and an
optional HTTPS worker gateway.

### B. Sprint Orchestration (`src/sprint/`, `src/domain/sprint/`)
- **Orchestrator + steps** (`src/sprint/steps/`): preflight, load-subtasks, start-ready-tasks,
  qa-review, completion, status-derivation, protocol.
- **Cycle runner / watch loop** (`src/domain/sprint/orchestrator/`): DAG dependency resolution,
  scheduling, continuous PR/CI/task monitoring, run heartbeat, state machine.
- **CI gating** (`src/domain/sprint/ci/`): merge policies that gate on CI; QA is fail-closed.

### C. Provider Execution (`src/infrastructure/providers/cli/`, `src/services/`)
On-demand, Docker-backed provider runs.
- Docker runner, workspace manager, credential mounts, PR service, provider command specs,
  telemetry/usage watchers.
- Handles CI autofix and merge-conflict resolution in isolated workspaces.
- Providers: Gemini, Codex, Claude Code, Qwen, OpenCode, Antigravity (local CLIs) + Jules (hosted).

### D. Repository Pattern (`src/repositories/`)
Strict separation of storage from business logic, over **SQLite** (`db/` holds schema, migrations,
adapters). Settings/sessions/execution/memory are DB-backed. Sprint **subtasks round-trip to markdown
with YAML frontmatter** (in each project's `.code-ux/` dir) for portable, reviewable task definitions.

---

## 📏 4. Detailed Coding Standards

### ESM & Import Rules (CRITICAL)
- **Mandatory extensions**: every import MUST include `.js`, even for `.ts` sources.
  - ✅ `import { Task } from "./task-types.js";`  ❌ `import { Task } from "./task-types";`
- **Native ESM**: no `require()` / CommonJS in `src/`.

### TypeScript Strictness
- **No `any`** unless documented as an unavoidable external boundary; prefer `unknown` or interfaces.
- **Explicit return types** on all exported functions and public methods.
- **Constructor DI** via the factories in `src/app/dependency-factory/`.

### Naming Conventions
- **Classes/Types/Components**: `PascalCase`. **Variables/Functions**: `camelCase`.
- **Constants**: `SCREAMING_SNAKE_CASE` (true globals only). **Files**: `kebab-case`.

### Frontend (Preact / Tailwind)
- Atomic, reusable components in `dashboard/src/v2/components/`.
- `@preact/signals` for global state. Tailwind v4 for all styling — no large UI frameworks.

---

## 🎨 5. Frontend Design: "Warm Void" Philosophy

All UI work must meet the quality gate in `STYLEGUIDE.md`:
- **Background**: warm charcoal `void-900` `#0E0C0A` (never pure black); light mode cream `#F9F8F4`.
- **Primary accent**: Signal Jade `#00E0A0` — carries all interactive meaning; never add a decorative hue.
- **Secondary accent**: Ember `#FFB800` — metric cards / sprint cycles only, never interactive.
- **Spacing**: generous whitespace; space is content.
- **Motion**: every animation must serve meaning (e.g. task-state transitions).

---

## 🧪 6. Quality Assurance & Validation

### Testing Strategy
- **Framework**: Vitest. Default env is Node; UI tests opt into jsdom via `@vitest-environment` pragmas.
  Tests use an in-memory DB (`VITEST_IN_MEMORY_DB=true`).
- **Coverage thresholds** (vitest.config.ts, ratchet-only — never lower): lines 73.2%, functions
  67.5%, branches 61.13%, statements 72.0%. `src/server/activity-cache-service.ts` has an 80% line gate.
- **Mocking**: `vi.mock()` for external boundaries (provider CLIs, Docker, FS, Jules API);
  `vi.spyOn()` for verification.

### Validation Workflow (`pnpm run ci`)
Before a task is complete, all of these MUST pass (`ci` = lint → backend coverage → dashboard → build):
1. `pnpm run lint` (alias of `typecheck`: strict `tsc --noEmit`).
2. `pnpm run test:backend:coverage`.
3. `pnpm run test:dashboard`.
4. `pnpm run build` (server `tsc` + dashboard typecheck + `vite build`).

---

## 🌿 7. Git Workflow & Local Dev Access

### Branching & PRs
- **`dev` is the integration branch.** Work from a feature branch off `dev` (never commit directly to
  `dev` or `main`). Names: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Conventional Commits.
- **Open PRs into `dev`, not `main`** — `gh pr create --base dev`.
- **Remotes**: `origin` is the **`numnx/codeux` fork** — push branches there and target it for PRs.
  `upstream` is `codeux-ai/codeux`; do not push or PR there unless explicitly asked.

### Local dev access (this environment)
- **Full access to the database and environment** — read/write `~/.code-ux/app.db` via `node:sqlite`;
  inspect/modify env state as needed.
- **Restart the dev server on port 4444 anytime** (e.g. `pnpm run dev`) when a change needs to take
  effect — no need to ask first.
- **Run test sprints in the project "Simple Test 2"**, which uses a local model for testing.
  Dispatching sprints/tasks there is safe and expected; use it for end-to-end orchestration checks,
  not real projects.

---

## 🛡️ 8. Repository Hygiene & Security (ABSOLUTE)

- **Temporary files**: delete every temp file you create before concluding a task. Do not commit while
  temp/scratch files are present in the workspace.
- **Credentials**: never hardcode `JULES_API_KEY` or other provider keys; never commit `.env`. Most
  provider config is set from the dashboard and stored in the DB, not env vars.
- **Docs**: source of truth is `docs/` (entrypoint `docs/index.md`, index `docs/SUMMARY.md`);
  `docs-web/` holds the published user/developer/architecture docs. Update affected pages on behavior
  changes; add + link a new page for new subsystems.

---

## 🤖 9. Agent Orchestration Strategy

Code UX routes each invocation type to a configurable agent preset (system/project/sprint scope),
synced to project markdown and reusable across all provider CLIs:
- **Planning** — decomposes goals into atomic, testable, dependency-aware subtasks.
- **Implementation** — surgical, research-led code changes inside the task workspace.
- **QA review** — fail-closed verification of completed work (gates merges).
- **CI repair & merge-conflict** — isolated repair flows when gates fail.
- **Project Setup Agent** — bootstraps tailored agents, quicksprint templates, and preview scripts for
  new repositories.

---
*Status: Code UX runtime — multi-provider, container-first.*
