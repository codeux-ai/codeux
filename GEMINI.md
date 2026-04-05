# GEMINI Context: Jules Agent OS / MCP Server

This project is a production-grade **Model Context Protocol (MCP)** server and orchestration engine for the **Jules Agent API**. It enables autonomous sprint management, codebase intelligence, and on-demand virtual worker provisioning.

---

## 🚀 1. Project Mission & Identity
To bridge high-level LLM orchestration with low-level codebase execution. The system transforms natural language sprint goals into atomic, test-validated PRs through a network of specialized agents and isolated Docker environments.

---

## 🛠️ 2. Core Technology Stack

### Backend (Node.js/ESM)
- **Runtime**: Node.js 22.x (Strict ESM mode).
- **Language**: TypeScript 5.6+ (Strict compiler settings).
- **Protocol**: Model Context Protocol (MCP) via `@modelcontextprotocol/sdk`.
- **API**: Axios for Jules REST API integration.
- **Logging**: Structured JSON logging with request correlation IDs.

### Frontend (Preact/Vite)
- **Framework**: Preact (Lean React-alternative).
- **Styling**: Tailwind CSS v4 (Zero-runtime, high-performance).
- **State**: Signals-based reactivity (via Preact Signals).
- **Animation**: GSAP (GreenSock) for high-fidelity interactive feedback.
- **Icons**: Lucide Icons.

### Infrastructure & Isolation
- **Containerization**: Docker (used for provisioning isolated "Virtual Workers").
- **Git**: Local worktree management for parallel task execution.
- **Process Management**: Custom CLI process runners with strict output sanitization.

---

## 🏗️ 3. Architectural Deep Dive

### A. The MCP Layer (`src/mcp/`)
Exposes 12+ tools including `sprint_agent`, `task_agent`, and `list_all_sources`. It acts as the primary interface for external LLMs to interact with the internal domain logic.

### B. Sprint Orchestration (`src/domain/sprint/`)
- **Cycle Runner**: Manages task dependency resolution (DAG) and scheduling.
- **Watch Loop**: Continuous background process that monitors PR status, CI results, and task completion.
- **PR Gating**: Automated merge policies that ensure PRs only merge if all CI checks pass.

### C. Virtual Workers (`src/services/virtual-worker-service.ts`)
On-demand agent provisioning.
- Uses **Docker** to spin up isolated environments for code modification.
- Handles automated **CI Autofixing** and **Merge Conflict Resolution**.
- Integrates multiple LLM providers (Gemini, Claude, Codex) as execution backends.

### D. Repository Pattern (`src/repositories/`)
Strict separation between data storage and business logic.
- Subtasks and Sprints are stored as **Markdown files with YAML frontmatter**.
- Settings and Session Tracking use file-based JSON repositories.

---

## 📏 4. Detailed Coding Standards

### ESM & Import Rules (CRITICAL)
- **Mandatory Extensions**: All imports MUST include the `.js` extension, even if the source file is `.ts`.
  - ✅ `import { Task } from "./task-types.js";`
  - ❌ `import { Task } from "./task-types";`
- **Native ESM**: No `require()` or CommonJS modules in the `src/` directory.

### TypeScript Strictness
- **No `any`**: The use of `any` is strictly prohibited unless documented as an unavoidable external boundary. Use `unknown` or specific interfaces.
- **Explicit Returns**: All exported functions and public class methods MUST have explicit return types.
- **Constructor DI**: Use constructor-based dependency injection for testability.

### Naming Conventions
- **Classes/Types**: `PascalCase`.
- **Variables/Functions**: `camelCase`.
- **Constants**: `SCREAMING_SNAKE_CASE` (only for true global constants).
- **Files**: `kebab-case` for all source files.

### Frontend (Preact/Tailwind)
- **Component Design**: Atomic, reusable components in `dashboard/src/v2/components/`.
- **Signals**: Prefer `@preact/signals` for global state (Dashboard settings, live logs).
- **No Heavy Libraries**: Avoid large UI frameworks. Use Tailwind v4 for all styling.

---

## 🎨 5. Frontend Design: "Warm Void" Philosophy

All UI work must meet the "Award-Winning" quality gate defined in `STYLEGUIDE.md`:
- **Color Palette**: 
  - Background: `#0E0C0A` (Void-900).
  - Accent: `#00E0A0` (Signal Jade) for all interactive signals.
  - Secondary: `#FFB800` (Ember) for metrics.
- **Spacing**: Generous whitespace. Space is considered content.
- **Motion**: Every animation must serve meaning (e.g., transition between task states).

---

## 🧪 6. Quality Assurance & Validation

### Testing Strategy
- **Framework**: Vitest.
- **Thresholds**: 
  - **80% Line Coverage** for core logic.
  - **69% Function Coverage**.
- **Mocking**: Use `vi.mock()` for external boundaries (Jules API, Docker, File System).

### Validation Workflow (`npm run ci`)
Before any task is considered complete, the following MUST pass:
1. `npm run lint`: ESLint + Prettier.
2. `npm run typecheck`: Strict `tsc` validation.
3. `npm run test`: Unit and integration suite.
4. `npm run build`: Production build (TSC + Vite).

---

## 🛡️ 7. Mandatory Repository Hygiene (ABSOLUTE)

To maintain a production-grade workspace, these rules are **NON-NEGOTIABLE**:

### A. Temporary File Management
- **Identify**: Temporary files that you have created.
- **Action**: You MUST delete all such files before concluding a task.
### B. Commit Lock
- **RULE**: **COMMITS ARE NOT ALLOWED** as long as temporary files are present in the workspace.
- **Validation**: Check if there are any temporary files in the workspace before committing.

### C. Credential Security
- Never hardcode `JULES_API_KEY`.
- Never commit `.env` files.
- Use `.env.example` as the single source of truth for required environment variables.

---

## 🏗️ 8. Agent Orchestration strategy

The project uses a **Tri-Agent Skill Architecture** for sprint execution:
1. **The Orchestrator** (`orchestrator.md`): The high-level manager. Uses MCP tools to plan and track.
2. **The Planning Specialist** (`sprint_agent_guide.md`): Decomposes goals into "Jules-Ready" (atomic, testable) subtasks.
3. **The Jules Technical Worker** (`worker.md`): The implementation expert. Focuses on research-led, surgical code changes.

---
*Last Updated: Saturday, April 4, 2026*
*Status: Production Baseline V2.1*
