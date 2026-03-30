const fs = require('fs');
const path = require('path');

const targetPath = path.resolve('tests/backend/server/dashboard-server.test.ts');
let content = fs.readFileSync(targetPath, 'utf8');

const newTests = `
  it("enforces full snapshot replace and recovery via snapshot_required when falling behind unrecoverably on split updates", async () => {
    const realtimeService = await createRealtimeService();
    const handle = await startTestServer(realtimeService);

    // Initial event
    realtimeService.scheduleProjectExecutionRefresh("project-1");
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Force massive gap (e.g. 1000 events)
    for(let i = 0; i < 200; i++) {
        realtimeService.scheduleProjectExecutionRefresh("project-1");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    const socket = await openRealtimeSocket(handle.port);
    try {
      socket.send(JSON.stringify({
        type: "set_subscriptions",
        scopes: ["project:project-1"],
        lastSequence: 1, // Completely outdated
      }));

      const snapshotRequired = await waitForRealtimeMessage(socket, (message) => (
        message.type === "snapshot_required"
      ));
      expect(snapshotRequired).toMatchObject({
        type: "snapshot_required",
        reason: "replay_window_exceeded",
      });
    } finally {
      socket.close();
    }
  });
`;

content = content.replace(/}\);$/, newTests + '});');
fs.writeFileSync(targetPath, content, 'utf8');
