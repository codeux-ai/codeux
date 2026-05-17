# Sprint OS
Production-grade agentic sprint orchestration via MCP.

[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-blue.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-MCP-green.svg)](https://modelcontextprotocol.io/)

Sprint OS is a production-grade MCP server and multi-provider virtual worker engine supporting Jules, Gemini, Codex, Claude Code, and Qwen Code. It exposes a powerful suite of sprint orchestration tools alongside a real-time V2 Preact dashboard. Under the hood, a DB-backed sprint orchestration engine provides dependency-aware DAG scheduling and Git/CI intelligence to automate development workflows.

## 📚 Documentation

Project documentation index:
- [`docs/index.md`](./docs/index.md)

---

## ✨ Key Features

- **Sprint Orchestration**: Intelligent task delegation with DAG dependency scheduling.
- **Live Web Dashboard**: A beautiful, real-time V2 Preact dashboard to monitor your sprint progress at `http://localhost:4444`.
- **AI Integrations**: Five supported AI provider integrations for varied workflows.
- **Virtual Worker Routing**: Flexible execution using MANUAL, WEIGHTED, or ORCHESTRATOR routing strategies.
- **Hierarchical Settings**: SQLite-backed settings following a system → project → sprint scope hierarchy.
- **CI Intelligence**: Built-in git/CI intelligence with automated PR merge gates.
- **Enterprise-Grade Tools**: 12+ MCP tools covering the full Jules API surface.
- **Safety First**: Configurable emergency stop safety mechanism to prevent runaway loops.
- **Customizable Protocol**: DB-backed editable instruction templates for protocol tuning.

---

## Installation

### Global Install (NPM)

Install globally via NPM to use the `jules-subagents` command anywhere:

```bash
npm install -g jules-subagents
```

Verify the installation:

```bash
jules-subagents --help
```

### Build from Source

Building from source requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm run build
pnpm start
```

---

## Quickstart

Configure your API key using one of these methods (in priority order):

1. **CLI Flag** (highest priority):
   ```bash
   --api-key YOUR_KEY
   ```
2. **Environment Variable**:
   ```bash
   export JULES_API_KEY=YOUR_KEY
   ```
   *(Note: `JULES_KEY` can also be used as a fallback)*
3. **`.env` file** in the project root:
   ```env
   JULES_API_KEY=YOUR_KEY
   ```
4. **`settings.json`** in `.jules-subagents/` (project or home directory):
   ```json
   {
     "julesApiKey": "YOUR_KEY"
   }
   ```

Run the development server:

```bash
pnpm run dev
```

Open the dashboard in your browser at `http://localhost:4444`. The server automatically increments the port (4445, 4446, etc.) if 4444 is in use. You can also override this by setting `DASHBOARD_PORT`.

Verify health via API endpoints from another terminal:

```bash
curl http://localhost:4444/api/status
```

### Common First Workflow

1. Configure system settings in the dashboard, then adjust project settings and sprint overrides as needed.
2. Create the sprint and tasks. (Code UX automatically prepares the local feature branch when orchestration starts).
3. Connect your worker with `listen` so it can monitor inbox, dispatch, and attention events for the project.
4. Start the sprint from the dashboard.
5. Follow the merge/action-required protocol shown in the dashboard and resume the sprint there when manual work is finished.

---

## MCP Client Setup

### Gemini CLI
You can add the server by editing your `~/.gemini/settings.json` or using the one-line CLI command.

**Manual Configuration (`~/.gemini/settings.json`):**
```json
{
  "mcpServers": {
    "jules": {
      "command": "npx",
      "args": ["-y", "jules-subagents"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**CLI Command:**
```bash
gemini mcp add jules npx -- -y jules-subagents --api-key your_api_key_here
```

### Codex CLI
Add to your `~/.codex/config.toml` or use the one-line CLI command.

**Manual Configuration (`~/.codex/config.toml`):**
```toml
[mcp_servers.jules]
command = "npx"
args = ["-y", "jules-subagents", "--api-key", "your_api_key_here"]
```

**CLI Command:**
```bash
codex mcp add jules -- npx -y jules-subagents --api-key your_api_key_here
```

### Claude Desktop
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jules-subagents": {
      "command": "npx",
      "args": ["-y", "jules-subagents"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Claude Code
Add to your `.claude/settings.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "jules-subagents": {
      "command": "npx",
      "args": ["-y", "jules-subagents"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 📊 Live Web Dashboard

The Jules Subagents MCP server includes a built-in, real-time web dashboard to visualize your sprint progress.

- **URL**: `http://localhost:4444`
- **Real-time**: Automatically polls every 10 seconds for live status updates.
- **Live Session Logs**: The dashboard consumes a dedicated local endpoint (`/api/live-activities`) that refreshes active task activities from Jules every 10 seconds.
- **Visuals**: Track active tasks (⏳), completed integrations (✅), and potential blockers (🚫) with an award-winning UI.
- **Activity Feed**: View live logs and automated protocol instructions in a clean, side-by-side view.

Simply open the URL in your browser once the orchestration begins to watch Jules work in real-time.

---

## 🏗️ Sprint Orchestration Workflow

The `sprint_agent` tool provides a professional framework for managing complex sprints.

### 1. Planning (`action: "plan"`)
Initializes `.jules-subagents/sprints/sprint<N>-subtasks/`. Break your sprint into independent and sequential tasks.
```markdown
title: Implement Auth API
depends_on: [setup-db]
is_independent: true
merged: false
prompt: Create the login and register endpoints in src/auth.
```

### 2. Status (`action: "status"`)
Get a real-time report of all subtasks, their dependencies, and linked Jules sessions. Defaults to continuous monitoring (`wait: true`).

### 3. Orchestration (`action: "orchestrate"`)
- **Parallelism**: Automatically starts Jules sessions for all ready, independent tasks.
- **Continuous Mode**: Defaults to `wait: true`. Monitors progress every 120s and automatically starts dependent tasks.
- **Automatic Retries**: Failed tasks are automatically retried in a new session (default `retry_failed: true`).
- **Mandatory Merge Step**: Dependent tasks are only started when their dependencies are both `COMPLETED` and have `merged: true` set in their subtask file.
- **Integration Instructions**: Provides explicit CLI instructions for merging PRs and updating subtask states.
- **Finalization**: Automatically provides steps for merging the main feature branch into `main` and proceeding to the next sprint.

---

## 🛠️ Tool Capabilities & Options

### ⚡ Automation Mode
The `create_session`, `task_agent`, and `sprint_agent` tools support `automation_mode: "AUTO_CREATE_PR"`. When enabled, Jules will automatically create a Pull Request upon successful task completion.

### ⏳ Waiting for Completion
Tools like `task_agent` and `wait_for_session_completion` allow you to block until a task is finished.
- **Poll Interval**: Default 10s.
- **Timeout**: Default 900s (15 minutes).

### 📊 Sprint Status Icons
| Icon | State | Action Required |
|---|---|---|
| ✅ | **MERGED** | None. Task is fully integrated. |
| 🤝 | **COMPLETED** | **Manual**: Merge the PR and set `merged: true` in the subtask file. |
| ⏳ | **RUNNING** | None. Jules is currently working. |
| ❌ | **FAILED** | **Auto**: Retried in a new session (if `retry_failed: true`). |
| 🚫 | **BLOCKED** | **Manual**: Check and merge dependencies. |
| 💤 | **PENDING** | None. Waiting for resources or the next cycle. |

---

## ⚙️ Configuration & Safety

The server uses a hierarchical configuration system and built-in safety mechanisms to ensure reliable operation.

### 🔍 Configuration Search Priority
The server loads settings from `settings.json` and agent guides from `.jules-subagents/` in the following order (highest priority first):
1.  **Current Working Directory**: `./.jules-subagents/`
2.  **Project Root**: `<project_root>/.jules-subagents/`
3.  **Home Directory**: `~/.jules-subagents/`
4.  **Environment Variables**: (Lowest priority baseline)

### 🛡️ Emergency Stop (Retry Safety)
To prevent runaway API calls and excessive cost in case of persistent errors, the server implements an **Emergency Stop** mechanism:
- **Consecutive Failure Tracking**: The server monitors consecutive failures when starting new Jules tasks.
- **Stop Threshold**: If a specified number of tasks fail to start in a row, the server enters an emergency stop state and blocks further task creation.
- **Default Threshold**: 5 consecutive failures.
- **Configuration**: You can adjust this threshold using the `maxFailures` setting in your `settings.json` or via the `JULES_API_MAX_FAILS` environment variable.

### 📝 Example `settings.json`
Place this in `~/.jules-subagents/settings.json` or your project folder:
```json
{
  "maxFailures": 10
}
```

---

## 🎨 Customizing Agent Guides

The server uses Markdown guides to define engineering standards and orchestration logic. You can override the default guides by placing your own versions in the hierarchical search paths mentioned above.

### 📝 Overridable Guides
- `worker.md`: Technical standards injected into every Jules agent session.
- `sprint_agent_guide.md`: Operating guide for the main agent during the "plan" phase.
- `orchestrator.md`: Guidance for the main agent during the "orchestrate" and "status" phases.
- `watch.md`: Operating instructions for the continuous orchestration loop.

---

## 🛠️ Available Tools

### 1. Sprint & Task Management
| Tool | Description |
|---|---|
| `sprint_agent` | The core orchestrator for planning and executing complex multi-task sprints. |
| `task_agent` | Execute a single specific task with built-in engineering standards, support for custom titles/branches, and optional completion waiting (`wait: true`). |

### 📂 Sources
| Tool | Description |
|---|---|
| `get_source` | Detailed metadata for a specific repository. |
| `list_sources` | Paginated list of connected sources. |
| `list_all_sources` | Convenience tool to fetch all sources automatically. |

### 💬 Sessions
| Tool | Description |
|---|---|
| `create_session` | Start a new agent task. Supports `require_plan_approval` and `automation_mode: "AUTO_CREATE_PR"`. |
| `get_session` | Monitor state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). Includes `last_activity` for real-time status updates. |
| `list_sessions` | List recent agent interactions. |
| `approve_session_plan` | Authorize an agent to proceed with a plan. |
| `send_session_message` | Send follow-up instructions to an active agent. |
| `wait_for_session_completion`| Poll until completion, failure, or PR creation with configurable `poll_interval` and `timeout`. |

### 📊 Activities
| Tool | Description |
|---|---|
| `get_activity` | Details for a specific interaction step. |
| `list_activities` | History of all interactions in a session. |
| `list_all_activities` | Convenience tool to fetch the full session history. |

---

## Development

Node.js 20+ is required for local development. Node.js 22 is required to pass the full CI pipeline.

Start the development server from source:
```bash
pnpm run dev
```

Build the project (compiles TypeScript and builds the Vite dashboard):
```bash
pnpm run build
```

Run tests:
```bash
pnpm run test
pnpm run test:coverage
```

Run static analysis:
```bash
pnpm run typecheck
pnpm run lint
```

Run the full CI gate (linting, tests, and build):
```bash
pnpm run ci
```

---

## 🔐 Configuration Reference

| Flag / Var | Source | Description |
|---|---|---|
| `--api-key <key>` | CLI Argument | Highest priority API key source. |
| `JULES_API_KEY` | Environment | Recommended environment variable. |
| `JULES_KEY` | Environment | Fallback environment variable. |
| `JULES_API_BASE_URL`| Environment | Override the default Google API endpoint. |

---

## 📄 License 

This project is licensed under the **ISC License**.
