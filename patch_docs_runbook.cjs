const fs = require('fs');
const file = 'docs/operations/runbook.md';
let content = fs.readFileSync(file, 'utf8');

const injection = `- If logs show \`malformed_snapshot_identity\`, \`selected_sprint_missing_while_active\`, \`selected_sprint_outside_project\`, or \`active_runs_mismatch_snapshot_scope\`, runtime state may be temporarily inconsistent. Restarting the dashboard server should reconcile the local state.
- If logs show \`repeated_unhealthy_recovery_patterns\`, a client is struggling to keep its WebSocket synced. Check the client's network connection or if a proxy is severing long-lived connections.
`;

// Insert under "### 1a. Dashboard loads slowly or live view feels stale during a sprint"
const search = "### 1a. Dashboard loads slowly or live view feels stale during a sprint\nChecks:\n";
content = content.replace(search, search + injection);

fs.writeFileSync(file, content);
console.log('patched runbook');
