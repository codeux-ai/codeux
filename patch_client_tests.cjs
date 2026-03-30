const fs = require('fs');
const path = require('path');

const targetPath = path.resolve('tests/dashboard/lib/dashboard-realtime-client.test.ts');
let content = fs.readFileSync(targetPath, 'utf8');

const newTests = `
  it("dispatches snapshot_required immediately upon receiving from server when gap is unrecoverable", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    const socket = MockWebSocket.instances[0];
    socket?.emit("open");

    socket?.emit("message", { type: "snapshot_required" });
    expect(listener).toHaveBeenCalledWith({ type: "snapshot_required" });

    unsubscribe();
  });
`;

content = content.replace(/}\);$/, newTests + '});');
fs.writeFileSync(targetPath, content, 'utf8');
