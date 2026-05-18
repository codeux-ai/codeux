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

## Live Dashboard

The project features a real-time V2 web dashboard to visualize your sprint progress and orchestrate agents.

- **Default URL**: `http://localhost:4444` (starts automatically with the server).
- **Health APIs**: The dashboard exposes health APIs at `/api/status`, `/api/system-settings`, and `/api/git-status`.

### Dashboard Pages

- **Tasks**: Real-time task execution, DAG visualization, and boat-race timeline. Features key visualizations like `SprintBoatRace` (animated task timeline) and `SprintDag` (dependency graph).
- **Projects**: Multi-project workspace management.
- **Settings**: AI provider config, system and project overrides.
- **Agents**: Virtual worker management and presets.
- **Chat**: Interactive chat with AI providers via the dashboard.
- **Browser**: Live preview and deployment integration.
- **Live Session**: Active Jules session monitoring.
- **Memory**: Agent memory inspection and management.
- **Stats**: Usage telemetry, git analytics, and token metrics by provider.

---

## AI Providers

The system includes a multi-provider virtual worker routing system.

### Built-in Provider Instances

| ID | Name | Type | Typical Use |
| :--- | :--- | :--- | :--- |
| `jules` | Google Jules | Google Jules API | Primary orchestration / planning |
| `gemini` | Google Gemini | Google Gemini | Virtual worker (code generation) |
| `codex` | OpenAI Codex | OpenAI Codex CLI | Virtual worker (code generation) |
| `claude-code` | Anthropic Claude Code | Anthropic Claude Code | Virtual worker (code generation) |
| `qwen-code` | Qwen Code | Qwen Code CLI | Virtual worker (code generation) |

### Routing Strategies

- **`MANUAL`**: Uses one exact provider instance.
- **`WEIGHTED`**: Load-balances requests across enabled instances based on assigned weight.
- **`ORCHESTRATOR`**: Jules picks the appropriate provider type, then selects an enabled instance within that type.

### Supported Invocation Routes

Providers can be explicitly routed for different invocation types:
- `task_coding`
- `planning`
- `dashboard_reply`
- `clarification_reply`
- `qa_review`
- `ci_fix`
- `merge_conflict`

### Virtual Workers

When configured with `executionMode: VIRTUAL`, virtual workers are ephemeral, one-shot processes. There are no persistent listen loops required. An ephemeral `virtual_cli` endpoint handles exactly one unit of work and is released.

### Advanced Configuration

You can add additional provider instances of the same type (e.g., two Codex credentials) with distinct weights, models, and auth-copy paths.

Per-instance credential isolation is handled via Docker auth-copy settings (`mountAuth`, `authPath`), allowing different instances to mount different local authentication directories into the runtime.

---

## Sprint Orchestration

The `sprint_agent` tool provides a DB-backed orchestration workflow for executing complex, multi-task projects with dependency management.

- **Sprint Creation Flow**: Create a project, then define tasks with titles and optional `dependsOn` keys. Sprint OS automatically resolves the DAG order.
- **Parallel Execution**: Tasks with no unsatisfied dependencies start immediately. Dependent tasks are blocked until all of their dependencies are `COMPLETED` and merged.
- **Automation Mode**: You can set `AUTO_CREATE_PR` on a task or at the sprint level. In this mode, the worker automatically opens a pull request upon completing its work.
- **CI Intelligence**: Sprint OS actively monitors PR statuses and CI checks. If CI checks fail, it can automatically trigger a `ci_fix` invocation route for the worker.
- **Emergency Stop**: To prevent runaway API spend, the sprint will enter an emergency stop state if a set number of consecutive task-start failures occur (default: 5). This is configurable via the `maxFailures` setting or `JULES_API_MAX_FAILS` environment variable.

### Sprint Status Icons
| Icon | State | Meaning |
|---|---|---|
| ✅ | **MERGED** | Task is fully integrated. |
| 🤝 | **COMPLETED** | PR is open. Merge required to satisfy dependencies. |
| ⏳ | **RUNNING** | Jules is currently working. |
| ❌ | **FAILED** | Task encountered an error. |
| 🚫 | **BLOCKED** | Waiting on upstream dependencies. |
| 💤 | **PENDING** | Task is defined but not yet started. |

---

## Settings & Configuration

The server persists configuration using a SQLite database located at `~/.sprint-os/settings.db`.

### Scope Hierarchy
Settings are resolved in the following priority order (highest wins):
1. **Sprint Overrides**: Settings specific to an active sprint execution.
2. **Project Overrides**: Settings configured for a specific project.
3. **System Defaults**: Global settings stored in the database.
4. **Built-in Code Defaults**: Fallbacks defined in the source code.

### Management
Settings should be managed primarily through the **Dashboard Settings Page**. No manual JSON editing is required.

For key and port configuration, you can optionally provide a local override file at `.jules-subagents/settings.json` within the project or home directory.

---

## Configuration Reference

| Setting | CLI Flag | Env Var | Description |
|---|---|---|---|
| API Key | `--api-key <key>` | `JULES_API_KEY` / `JULES_KEY` | Jules API authentication |
| Dashboard Port | — | `DASHBOARD_PORT` | Override default port 4444 |
| API Base URL | — | `JULES_API_BASE_URL` | Override Google API endpoint |
| MCP HTTP mode | `--mcp-http` | `MCP_HTTP_ENABLED` | Enable streamable HTTP transport |
| Headless mode | `--headless` | — | Run without dashboard UI |
| Runtime role | `--runtime-role` | — | Set server runtime role |

---

## Available MCP Tools

### Sprint & Task Management
| Tool | Description |
|---|---|
| `sprint_agent` | The core orchestrator for planning and executing complex multi-task sprints. |
| `task_agent` | Execute a single specific task with built-in engineering standards, support for custom titles/branches, and optional completion waiting (`wait: true`). |

### Sources
| Tool | Description |
|---|---|
| `get_source` | Detailed metadata for a specific repository. |
| `list_sources` | Paginated list of connected sources. |
| `list_all_sources` | Convenience tool to fetch all sources automatically. |

### Sessions
| Tool | Description |
|---|---|
| `create_session` | Start a new agent task. Supports `require_plan_approval` and `automation_mode: "AUTO_CREATE_PR"`. |
| `get_session` | Monitor state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). Includes `last_activity` for real-time status updates. |
| `list_sessions` | List recent agent interactions. |
| `approve_session_plan` | Authorize an agent to proceed with a plan. |
| `send_session_message` | Send follow-up instructions to an active agent. |
| `wait_for_session_completion`| Poll until completion, failure, or PR creation with configurable `poll_interval` and `timeout`. |
| `get_activity` | Details for a specific interaction step. |
| `list_activities` | History of all interactions in a session. |
| `list_all_activities` | Convenience tool to fetch the full session history. |

---

## Development

Node.js 22 is required for CI, while Node.js 20+ is sufficient for local development.

| Command | Description |
|---|---|
| `pnpm run dev` | Run the development server from source |
| `pnpm run build` | Build the project |
| `pnpm run test` | Run unit tests |
| `pnpm run test:coverage` | Run tests with coverage |
| `pnpm run ci` | Full CI gate |
| `pnpm run typecheck` | Run type checking |
| `pnpm run lint` | Run the linter |

---

## Documentation

For a comprehensive index of the project's documentation, please refer to the [Documentation Index](./docs/index.md).

We recommend following one of three reading paths based on your needs:
- **New to the project**: Get started with the quickstart, system overview, and dashboard guide.
- **Building orchestration behavior**: Learn about DB-native orchestration, the execution schema, and worker endpoint foundations.
- **MCP integrator**: Understand tool contracts, runtime dispatch, and operational runbooks.

---

## License

This project is licensed under the **ISC License**.
