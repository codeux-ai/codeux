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

### From Source
```bash
git clone https://github.com/numnx/jules-agent-mcp.git
cd jules-agent-mcp
npm install
npm run build
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
| `getSource` | Get detailed metadata for a repository source. |
| `listSources` | Paginated list of connected sources. |
| `listAllSources` | Fetches all sources across all pages. |

### Sessions
| Tool | Description |
|---|---|
| `createSession` | Start a new agent task (e.g., "Implement feature X"). |
| `getSession` | Check current state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). |
| `listSessions` | List recent sessions. |
| `approveSessionPlan` | Approve a generated plan to start implementation. |
| `sendSessionMessage` | Interaction with the agent during a session. |
| `waitForSessionCompletion` | Polls until terminal state or PR creation. |

### Activities
| Tool | Description |
|---|---|
| `getActivity` | Get details for a specific activity step. |
| `listActivities` | Paginated list of session interactions. |
| `listAllActivities` | All interactions for a session. |

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
