# GEMINI Context: Jules Subagents MCP Server

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
  - `dashboard/`: A real-time Preact-based web dashboard for visualizing sprint progress.
  - `.jules-subagents/`: The primary directory for agent configuration and sprint management.
    - `agents/`: Contains Markdown guides that define the technical standards and orchestration logic for Jules agents.
      - `worker.md`: Defines the "Technical Baseline" for all subtasks.
      - `orchestrator.md`: Defines the logic for the `sprint_agent` tool.
      - `sprint_agent_guide.md`: Operating instructions for the main orchestrator agent.
      - `watch.md`: Operating instructions for the continuous orchestration loop.
      - `watch-skill.md`: A skill-like instruction for re-entering the watch loop.
    - `sprints/`: Contains sprint definitions (`sprint-<N>.md`) and their corresponding subtasks.

## 🛠️ Building and Running

### Development
- **Install Dependencies**: `npm install`
- **Run in Dev Mode**: `npm run dev` (uses `ts-node-esm`)
- **Build**: `npm run build` (runs `tsc`)

### Production / CLI Usage
- **Start**: `npm start` (runs `node dist/index.js`)
- **Direct Execution**: `node dist/index.js --api-key YOUR_KEY`
- **Global Command**: Once linked via `npm link`, use the `jules-subagents` command.

### Configuration & Safety
The server looks for settings and guides in a hierarchical order (CWD > Project Root > Home Dir):
1.  **API Key**: `--api-key` flag, `JULES_API_KEY` env, or `.env` file.
2.  **Settings**: `settings.json` in `.jules-subagents/` folders.
3.  **Emergency Stop**: Automatically halts task creation after 5 (default) consecutive failures, configurable via `maxFailures` or `JULES_API_MAX_FAILS`.

## 🏗️ Agent Orchestration Architecture

The system uses a **tri-agent skill architecture** to ensure absolute precision in sprint execution. Instructions are delivered via specific Markdown guides injected into agent contexts.

### 1. The Orchestrator (`.jules-subagents/agents/orchestrator.md`)
- **Role**: High-level manager connecting via MCP.
- **Tools**: `sprint_agent(action: "status" | "orchestrate" | "plan")`, `create_session`, `wait_for_session_completion`.
- **Operating Protocol**: Follows a strict tool-to-phase mapping and error recovery algorithm.

### 2. The Planning Specialist (`.jules-subagents/agents/sprint_agent_guide.md`)
- **Role**: Decomposes `.jules-subagents/sprints/sprint-<N>.md` into a DAG of subtasks.
- **Output**: Atomic markdown files in `.jules-subagents/sprints/sprint<N>-subtasks/`.
- **Constraint**: Each task must be "Jules-Ready" (atomic, testable, and independent).

### 3. The Jules Technical Skill (`.jules-subagents/agents/worker.md`)
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

## 📁 Key Files & Directories

- `src/index.ts`: The MCP server implementation.
- `dashboard/`: The Preact-based live monitoring dashboard.
- `.jules-subagents/`: Agent guidance and sprint data.
- `package.json`: Project metadata and dependency management.
- `tsconfig.json`: TypeScript configuration (ESNext, Node16 resolution).
- `.env.example`: Template for required environment variables.
