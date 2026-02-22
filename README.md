# 🤖 Jules Subagents MCP Server (v1.2.0)

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-MCP-green.svg)](https://modelcontextprotocol.io/)

A production-grade [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [Jules Agent API](https://developers.google.com/jules). This server empowers LLMs to interact with Jules for codebase management, agent session creation, and intelligent sprint orchestration.

---

## ✨ Key Features

- **🚀 Sprint Orchestration**: Intelligent task delegation with dependency management and parallel execution.
- **🛠️ Enterprise-Grade Tools**: 12+ tools covering the full Jules API with automatic pagination and robust error handling.
- **🧬 Smart Worker Context**: Automatically injects your technical standards into every Jules agent session.
- **🔌 Multi-Client Support**: Seamlessly integrates with Gemini CLI, Codex CLI, and Claude Desktop.
- **🛡️ Secure & Flexible Auth**: Support for environment variables, `.env` files, and command-line flags.

---

## 📦 Quick Installation

Install globally via NPM to use the `jules-subagents` command anywhere:

```bash
npm install -g jules-subagents
```

---

## ⚙️ Client Configuration

### 🌌 Gemini CLI
You can add the server by editing your `~/.gemini/settings.json` or using the one-line CLI command.

**Manual Configuration:**
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

### 💻 Codex CLI
Add to your `~/.codex/config.toml` or use the one-line CLI command.

**Manual Configuration:**
```toml
[mcp_servers.jules]
command = "npx"
args = ["-y", "jules-subagents", "--api-key", "your_api_key_here"]
```

**CLI Command:**
```bash
codex mcp add jules -- npx -y jules-subagents --api-key your_api_key_here
```

### 🤖 Claude Desktop
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

---

## 🏗️ Sprint Orchestration Workflow

The `sprint_agent` tool provides a professional framework for managing complex sprints.

### 1. Planning (`action: "plan"`)
Initializes `.jules-subagents/sprints/sprint<N>-subtasks/`. Break your sprint into independent and sequential tasks.
```markdown
title: Implement Auth API
depends_on: [setup-db]
is_independent: true
prompt: Create the login and register endpoints in src/auth.
```

### 2. Status (`action: "status"`)
Get a real-time report of all subtasks, their dependencies, and linked Jules sessions.

### 3. Orchestration (`action: "orchestrate"`)
- **Parallelism**: Automatically starts Jules sessions for all ready, independent tasks.
- **Branching**: Subtasks are isolated on their own branches created from the main feature branch.
- **Blocking**: Identifies and reports tasks that require manual intervention.

---

## 🎨 Customizing Agent Guides

The server uses Markdown guides to define engineering standards and orchestration logic. You can override the default guides by placing your own versions in your project repository or the current working directory.

### 🔍 Search Priority
The server searches for guides in this order:
1.  **Repository Path**:
    - `<repo_path>/.jules-subagents/agents/<guide>.md`
    - `<repo_path>/agents/<guide>.md`
    - `<repo_path>/.gemini/agents/<guide>.md`
    - `<repo_path>/<guide>.md`
2.  **Current Working Directory**:
    - `./.jules-subagents/agents/<guide>.md`
    - `./agents/<guide>.md`
    - `./.gemini/agents/<guide>.md`
    - `./<guide>.md`
3.  **Built-in Defaults**: The standard guides included with the MCP server.

### 📝 Overridable Guides
- `worker.md`: Technical standards injected into every Jules agent session.
- `sprint_agent_guide.md`: Operating guide for the main agent during the "plan" phase.
- `orchestrator.md`: Guidance for the main agent during the "orchestrate" and "status" phases.

---

## 🛠️ Available Tools

### 🏗️ Sprint & Task Management
| Tool | Description |
|---|---|
| `sprint_agent` | The core orchestrator for planning and executing complex multi-task sprints. |
| `task_agent` | Execute a single specific task with built-in engineering standards and optional completion waiting. |

### 📂 Sources
| Tool | Description |
|---|---|
| `get_source` | Detailed metadata for a specific repository. |
| `list_sources` | Paginated list of connected sources. |
| `list_all_sources` | Convenience tool to fetch all sources automatically. |

### 💬 Sessions
| Tool | Description |
|---|---|
| `create_session` | Start a new agent task. |
| `get_session` | Monitor state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). |
| `list_sessions` | List recent agent interactions. |
| `approve_session_plan` | Authorize an agent to proceed with a plan. |
| `send_session_message` | Send follow-up instructions to an active agent. |
| `wait_for_session_completion`| Poll until completion or PR creation. |

### 📊 Activities
| Tool | Description |
|---|---|
| `get_activity` | Details for a specific interaction step. |
| `list_activities` | History of all interactions in a session. |
| `list_all_activities` | Convenience tool to fetch the full session history. |

---

## 🛠️ Development & Source Build

If you want to contribute or run from source:

1.  **Clone & Install**:
    ```bash
    git clone https://github.com/numnx/jules-subagents-mcp.git
    cd jules-subagents-mcp
    npm install
    ```
2.  **Environment Setup**:
    ```bash
    cp .env.example .env
    # Add your JULES_API_KEY to the .env file
    ```
3.  **Build**:
    ```bash
    npm run build
    ```
4.  **Verification**:
    Test if the server starts correctly on stdio:
    ```bash
    node dist/index.js --api-key YOUR_KEY
    ```
5.  **Global Link**:
    ```bash
    npm link
    ```
6.  **Add to Gemini CLI (Manual Build)**:
    Once linked, you can use the `jules-subagents` command globally:
    ```bash
    gemini mcp add jules jules-subagents
    ```
    *Note: The server will automatically use the `.env` file and technical guides from the source directory, regardless of where you run the command.*

7.  **Alternative: Run Local Source with npx**:
    If you prefer not to use `npm link`, you can point `npx` directly to your project directory:
    ```bash
    gemini mcp add jules npx /path/to/jules-subagents-mcp
    ```
    *This is useful for testing local changes without modifying your global system path.*

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
