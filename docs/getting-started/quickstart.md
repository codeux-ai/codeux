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
If `4444` is occupied, startup automatically retries `4445`, `4446`, and so on.

## Verify Health via API Endpoints

From another terminal:

```bash
curl http://localhost:4444/api/status
curl http://localhost:4444/api/system-settings
curl http://localhost:4444/api/git-status
```

## Common First Workflow

1. Configure system settings in dashboard, then adjust project settings and sprint overrides as needed.
2. Create the sprint and tasks. Sprint OS now prepares the local feature branch automatically when orchestration starts, and it will attempt to push that branch to `origin` when the remote exists.
3. Create the sprint tasks in the dashboard, or import them from markdown if you are bringing in an existing sprint plan.
4. Connect your worker with `listen` so it can monitor inbox, dispatch, and attention events for the project.
5. Start the sprint from the dashboard.
6. Follow merge/action-required protocol shown in dashboard and resume the sprint there when manual work is finished.

## Troubleshooting

- `Jules API Key is missing`
  - Confirm key source and priority order.
- Dashboard port in use
  - Set `DASHBOARD_PORT` in `.env`, or configure `dashboardPort` in `config.json` or System Settings.
- Remote mode has no PR/CI data
  - Verify `gh` is installed and authenticated.

For operational issues, see [Operations Runbook](../operations/runbook.md).
