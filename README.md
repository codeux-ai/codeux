# Jules Agent MCP Server

Model Context Protocol (MCP) server for interacting with the Jules Agent API.

## Features

This MCP server provides tools to manage Jules Agent sources, sessions, and activities using enterprise-grade naming conventions.

- **Sources**: `getSource`, `listSources`, `listAllSources`
- **Sessions**: `createSession`, `getSession`, `listSessions`, `approveSessionPlan`, `sendSessionMessage`, `waitForSessionCompletion`
- **Activities**: `getActivity`, `listActivities`, `listAllActivities`

## Prerequisites

- Node.js (v18 or later)
- A Jules API Key (`X-Goog-Api-Key`)

## Installation

```bash
npm install -g @jules-agent/mcp-server
```

## Configuration

Set the following environment variable in your environment or a `.env` file:

- `JULES_API_KEY`: Your Jules API Key.

### Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jules-agent": {
      "command": "npx",
      "args": ["-y", "@jules-agent/mcp-server"],
      "env": {
        "JULES_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

## Tools Documentation

### `createSession`
Creates a new session for the agent to work on a specific source (e.g., GitHub repo).
- `prompt`: The initial instruction for the agent.
- `source`: The source identifier (e.g., `sources/github/owner/repo`).
- `startingBranch`: (Optional) The branch to start from.
- `requirePlanApproval`: (Optional) If set to `true`, the agent will wait for plan approval before executing.

### `sendSessionMessage`
Sends a follow-up message to an existing session.

### `waitForSessionCompletion`
Polls the session until it is completed (e.g., a PR has been created).

## Development

1. Clone the repository.
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run locally: `node dist/index.js`
