const fs = require('fs');
const file = 'docs/operations/logging-and-correlation.md';
let content = fs.readFileSync(file, 'utf8');

const injection = `
### Dashboard Realtime Telemetry
- \`project_live_snapshot_assembled\`: Logs the build time and byte size of an assembled project live snapshot.
- \`realtime_snapshot_published\`: Logs the published realtime snapshot event and size.
- \`realtime_background_refresh\`: Logs scheduled background dashboard refreshes (like overview telemetry).
- \`websocket_recovery_snapshot_required\`: Emitted when a client reconnects and needs a full snapshot payload.
`;

content += injection;
fs.writeFileSync(file, content);
console.log('patched logging');
