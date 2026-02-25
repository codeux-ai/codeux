# Quickstart

This guide gets the MCP server and dashboard running locally with minimal setup.

## Prerequisites

- Node.js 20+
- npm
- A valid Jules API key
- Optional for remote git intelligence: GitHub CLI (`gh`) authenticated

## Install and Build

```bash
npm install
npm run build
```

## Configure API Key

Use one of these methods:

1. CLI argument (highest priority)
```bash
node dist/index.js --api-key YOUR_KEY
```

2. Environment variable
```bash
export JULES_API_KEY=YOUR_KEY
npm start
```

3. `.env` file in project root
```env
JULES_API_KEY=YOUR_KEY
```

4. `.jules-subagents/settings.json` (project or home)
```json
{
  "julesApiKey": "YOUR_KEY"
}
```

## Run in Development

```bash
npm run dev
```

## Run Compiled Server

```bash
npm run build
npm start
```

## Open Dashboard

Default URL:
- `http://localhost:4444`

The dashboard starts automatically when the server starts.

## Verify Health via API Endpoints

From another terminal:

```bash
curl http://localhost:4444/api/status
curl http://localhost:4444/api/settings
curl http://localhost:4444/api/git-status
```

## Common First Workflow

1. Configure settings in dashboard.
2. Create or ensure sprint feature branch exists locally and on origin.
3. Run `sprint_agent` with `action: "plan"`.
4. Create subtask markdown files.
5. Run `sprint_agent` with `action: "orchestrate"`.
6. Follow merge/action-required protocol shown in dashboard.

## Troubleshooting

- `Jules API Key is missing`
  - Confirm key source and priority order.
- Dashboard port in use
  - Set `DASHBOARD_PORT` env var to another port.
- Remote mode has no PR/CI data
  - Verify `gh` is installed and authenticated.

For operational issues, see [Operations Runbook](../operations/runbook.md).
