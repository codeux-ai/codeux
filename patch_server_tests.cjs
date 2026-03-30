const fs = require('fs');
const path = require('path');

const targetPath1 = path.resolve('tests/backend/server/dashboard-realtime-websocket-server.test.ts');
let content1 = fs.readFileSync(targetPath1, 'utf8');

const newTests1 = `
  it("sends snapshot_required when recovery falls behind latest scope and replay is exhausted", () => {
    const { sendClientMessage, getWrittenJson } = setupClient();

    realtimeService.getLatestSequenceForScopes.mockReturnValue(200);
    realtimeService.getLatestSequence.mockReturnValue(200);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);
    // Simulate replay exhaustion (gap is unrecoverable via replay)
    realtimeService.replay.mockReturnValue([]);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 50, // Far behind 200
    });

    const responses = getWrittenJson();
    const snapshotReqs = responses.filter((r) => r.type === "snapshot_required");
    expect(snapshotReqs).toHaveLength(1);
    expect(snapshotReqs[0]).toEqual({
      type: "snapshot_required",
      reason: "non_replayable_event_missed",
    });
  });

  it("completes recovery by sending snapshot_required to force full snapshot replace", () => {
    const { sendClientMessage, getWrittenJson } = setupClient();

    realtimeService.getLatestSequenceForScopes.mockReturnValue(300);
    realtimeService.getLatestSequence.mockReturnValue(300);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 10,
    });

    const responses = getWrittenJson();
    expect(responses).toContainEqual({
      type: "snapshot_required",
      reason: "non_replayable_event_missed",
    });
  });
`;
content1 = content1.replace(/}\);$/, newTests1 + '});');
fs.writeFileSync(targetPath1, content1, 'utf8');
