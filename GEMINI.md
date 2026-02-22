# GEMINI Context: Jules Agent MCP Server

This project is a production-grade **Model Context Protocol (MCP)** server for the **Jules Agent API**. It enables LLMs to interact with Jules for codebase management, agent session creation, and intelligent sprint orchestration.

## 🚀 Project Overview

- **Core Purpose**: Bridging LLMs (like Gemini, Claude, Codex) with the Jules Agent API via the MCP standard.
- **Main Technologies**:
  - **Runtime**: Node.js (ES Modules)
  - **Language**: TypeScript
  - **Protocols**: MCP (Model Context Protocol)
  - **Key Libraries**: `@modelcontextprotocol/sdk`, `axios`, `dotenv`
- **Architecture**:
  - `src/index.ts`: The central entry point implementing the MCP server and its 12+ tools.
  - `agents/`: Contains Markdown guides that define the technical standards and orchestration logic for Jules agents.
    - `worker.md`: Defines the "Technical Baseline" for all subtasks (Linting, Testing, Playwright).
    - `orchestrator.md`: Defines the logic for the `sprint_agent` tool (Planning, Delegation, Branching).
    - `sprint_agent_guide.md`: Operating instructions for the main orchestrator agent.

## 🛠️ Building and Running

### Development
- **Install Dependencies**: `npm install`
- **Run in Dev Mode**: `npm run dev` (uses `ts-node-esm`)
- **Build**: `npm run build` (runs `tsc`)

### Production / CLI Usage
- **Start**: `npm start` (runs `node dist/index.js`)
- **Direct Execution**: `node dist/index.js --api-key YOUR_KEY`
- **Global Command**: Once linked via `npm link`, use the `jules-agent` command.

### Configuration
The server looks for the `JULES_API_KEY` in:
1.  `--api-key` CLI flag
2.  `JULES_API_KEY` environment variable
3.  `.env` file in the working directory

## 🏗️ Agent Orchestration Architecture

The system uses a **tri-agent skill architecture** to ensure absolute precision in sprint execution. Instructions are delivered via specific Markdown guides injected into agent contexts.

### 1. The Orchestrator (`agents/orchestrator.md`)
- **Role**: High-level manager connecting via MCP.
- **Tools**: `sprint_agent(action: "status" | "orchestrate" | "plan")`, `create_session`, `wait_for_session_completion`.
- **Operating Protocol**: Follows a strict tool-to-phase mapping and error recovery algorithm.

### 2. The Planning Specialist (`agents/sprint_agent_guide.md`)
- **Role**: Decomposes `sprints/sprint-<N>.md` into a DAG of subtasks.
- **Output**: Atomic markdown files in `sprints/sprint<N>-subtasks/`.
- **Constraint**: Each task must be "Jules-Ready" (atomic, testable, and independent).

### 3. The Jules Technical Skill (`agents/worker.md`)
- **Role**: The engineering baseline injected into EVERY Jules session.
- **Focus**: Award-winning design, strict TypeScript, and mandatory quality gates (Playwright).
- **Workflow**: Research -> Strategy -> Execution -> Validation.

## 🛠️ Tool-to-Phase Mapping Reference

| Phase | Primary MCP Tool | Secondary Tools |
|---|---|---|
| **Discovery** | `list_all_sources` | `get_source` |
| **Planning** | `sprint_agent(action: "plan")` | `read_file`, `write_file` |
| **Execution** | `sprint_agent(action: "orchestrate")` | `create_session` |
| **One-off Implementation** | `task_agent` | `wait_for_session_completion` |
| **Monitoring** | `sprint_agent(action: "status")` | `get_session`, `wait_for_session_completion` |
| **Verification** | `list_all_activities` | `get_activity` |

## 🚀 CI/CD

The project uses **GitHub Actions** for continuous integration.

- **Workflow**: `.github/workflows/ci.yml`
- **Trigger**: Pull requests to the `main` branch.
- **Actions**:
  1. Installs dependencies.
  2. Builds the project (`npm run build`).
  3. Runs unit tests (`npm test`).
  4. **Auto-Merge**: Attempts to enable auto-merge for the PR if all checks pass.

## 🧪 Testing Strategy

The project uses **Vitest** for unit testing. All tests are designed to run **without calling the Jules API** by mocking dependencies like `axios` and `fs`.

- **Run Tests**: `npm test`
- **Location**: `src/index.test.ts`
- **Focus**: Verifying name normalization, prompt injection, and orchestration logic.

## 📁 Key Files & Directories

- `src/index.ts`: The MCP server implementation.
- `agents/`: Domain-specific guidance for AI agents.
- `package.json`: Project metadata and dependency management.
- `tsconfig.json`: TypeScript configuration (ESNext, Node16 resolution).
- `.env.example`: Template for required environment variables.
