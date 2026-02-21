# Jules Agent MCP Server (v1.1.0)

A production-ready [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [Jules Agent API](https://developers.google.com/jules). This server allows LLMs to interact with Jules to manage codebase sources, create agent sessions, and monitor activity.

## Features

- **Enterprise-Grade Naming**: Tools use consistent camelCase naming conventions.
- **Full API Coverage**: Implements all Jules API v1alpha endpoints.
- **Pagination Handling**: Includes convenience tools like `listAllSources` and `listAllActivities` that handle token-based pagination automatically.
- **Robust Monitoring**: `waitForSessionCompletion` allows long-running agent tasks to be monitored with configurable polling.
- **Type-Safe Implementation**: Built with TypeScript for reliability.

## Prerequisites

- **Node.js**: v18.0.0 or later.
- **Jules API Key**: Obtain from the [Jules Developer Console](https://developers.google.com/jules).

## Installation

### From NPM (Global)
```bash
npm install -g @jules-agent/mcp-server
```

### From Source (Detailed)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/numnx/jules-agent-mcp.git
    cd jules-agent-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment:**
    Create a `.env` file from the provided example and add your API key:
    ```bash
    cp .env.example .env
    # Edit .env and replace your_api_key_here with your actual Jules API key
    ```

4.  **Build the project:**
    This compiles the TypeScript source into executable JavaScript in the `dist/` directory:
    ```bash
    npm run build
    ```

5.  **Verify the installation:**
    You can test if the server starts correctly by running it manually. It will wait for JSON-RPC input on `stdin`:
    ```bash
    node dist/index.js
    # You should see: "Jules Agent MCP server (v1.1.0) running on stdio"
    # Press Ctrl+C to exit.
    ```

6.  **Optional: Link globally for local development:**
    ```bash
    npm link
    # Now you can use 'jules-agent' command anywhere on your system
    ```

---

## Client Configuration

### 1. Gemini CLI Setup

Gemini CLI uses a `settings.json` file for configuration. You can add the Jules Agent server to your global settings (`~/.gemini/settings.json`) or a project-specific one (`.gemini/settings.json`).

**Manual Configuration:**
Add the server under the `mcpServers` key:

```json
{
  "mcpServers": {
    "jules": {
      "command": "npx",
      "args": ["-y", "@jules-agent/mcp-server"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**CLI Configuration (Recommended):**
```bash
gemini mcp add jules npx -- -y @jules-agent/mcp-server --env JULES_API_KEY=your_api_key_here
```

### 2. Codex CLI Setup

Codex CLI uses a `config.toml` file located at `~/.codex/config.toml` (global) or `.codex/config.toml` (project-scoped).

**Manual Configuration:**
Add a new `mcp_servers` table:

```toml
[mcp_servers.jules]
command = "npx"
args = ["-y", "@jules-agent/mcp-server"]
env = { JULES_API_KEY = "your_api_key_here" }
```

**CLI Configuration:**
```bash
codex mcp add jules --env JULES_API_KEY=your_api_key_here -- npx -y @jules-agent/mcp-server
```

### 3. Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jules-agent": {
      "command": "npx",
      "args": ["-y", "@jules-agent/mcp-server"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## Available Tools

### Sources
| Tool | Description |
|---|---|
| `get_source` | Get detailed metadata for a repository source. |
| `list_sources` | Paginated list of connected sources. |
| `list_all_sources` | Fetches all sources across all pages. |

### Sessions
| Tool | Description |
|---|---|
| `create_session` | Start a new agent task (e.g., "Implement feature X"). |
| `get_session` | Check current state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). |
| `list_sessions` | List recent sessions. |
| `approve_session_plan` | Approve a generated plan to start implementation. |
| `send_session_message` | Interaction with the agent during a session. |
| `wait_for_session_completion` | Polls until terminal state or PR creation. |

### Sprint Orchestration (v1.3.0)
| Tool | Description |
|---|---|
| `sprint_agent` | Orchestrates sprint subtasks by delegating work to Jules agents. |

#### `sprint_agent` Usage
This tool reads your `/sprints/sprint-N.md` and looks for subtasks in `/sprints/sprintN-subtasks/`.
- **`sprint_number`**: (e.g., 34)
- **`repo_path`**: Local path to the project repository.
- **`source_id`**: The Jules source ID for the repo.
- **`action`**:
    - `plan`: Creates the subtasks directory if missing.
    - `status`: Reports the current state of all subtasks and sessions.
    - `orchestrate`: Intelligently starts Jules sessions for ready subtasks (based on `depends_on`).

Subtasks should be defined as markdown files (e.g., `task-1.md`) in the subtasks directory with the following structure:
```markdown
title: Implement Dashboard Component
depends_on: [task-0, setup-env]
prompt:
Please implement the main dashboard component in src/components/Dashboard.tsx
---
(The prompt to be sent to Jules starts here)
```

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `JULES_API_KEY` | Your Google API Key with Jules access. | Yes |
| `JULES_API_BASE_URL` | Override for the API endpoint. | No |

## Development

- **Build**: `npm run build`
- **Lint**: `npm run lint` (if configured)
- **Local Test**: `node dist/index.js` (expects input on stdin)

## License

ISC
