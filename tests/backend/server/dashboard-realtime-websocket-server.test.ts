import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { bootDashboardRealtimeWebSocketServer } from "../../../src/server/dashboard-realtime-websocket-server.js";
import type { DashboardRealtimeService } from "../../../src/services/dashboard-realtime-service.js";
import type { Logger } from "../../../src/shared/logging/logger.js";
import type { Server as HttpServer, IncomingMessage } from "http";
import type { Socket } from "net";

function encodeFrame(payload: string): Buffer {
  const message = Buffer.from(payload, "utf8");
  const length = message.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), message]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, message]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, message]);
}

describe("DashboardRealtimeWebSocketServer", () => {
  let server: HttpServer;
  let realtimeService: vi.Mocked<DashboardRealtimeService>;
  let logger: vi.Mocked<Logger>;

  beforeEach(() => {
    server = new EventEmitter() as any;
    realtimeService = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      getLatestSequenceForScopes: vi.fn(),
      getLatestSequence: vi.fn(),
      hasNonReplayableEventsSince: vi.fn(),
      replay: vi.fn(),
    } as unknown as vi.Mocked<DashboardRealtimeService>;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as vi.Mocked<Logger>;

    bootDashboardRealtimeWebSocketServer({
      server,
      pathName: "/ws",
      realtimeService,
      logger,
    });
  });

  const setupClient = () => {
    const socket = new EventEmitter() as Socket;
    socket.write = vi.fn();
    socket.end = vi.fn();
    socket.destroy = vi.fn();

    const req = {
      url: "/ws",
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "testkey",
      },
    } as unknown as IncomingMessage;

    server.emit("upgrade", req, socket);

    // Skip the 101 Switching Protocols response and the "ready" message
    (socket.write as any).mockClear();

    const sendClientMessage = (message: any) => {
      const payload = Buffer.from(JSON.stringify(message), "utf8");
      const length = payload.length;

      let header: Buffer;
      if (length < 126) {
        header = Buffer.alloc(6);
        header[0] = 0x81;
        header[1] = length | 0x80; // mask bit set
      } else if (length < 65536) {
        header = Buffer.alloc(8);
        header[0] = 0x81;
        header[1] = 126 | 0x80;
        header.writeUInt16BE(length, 2);
      } else {
        header = Buffer.alloc(14);
        header[0] = 0x81;
        header[1] = 127 | 0x80;
        header.writeBigUInt64BE(BigInt(length), 2);
      }

      const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
      header.set(mask, header.length - 4);

      const maskedPayload = Buffer.alloc(length);
      for (let i = 0; i < length; i++) {
        maskedPayload[i] = payload[i] ^ mask[i % 4];
      }

      socket.emit("data", Buffer.concat([header, maskedPayload]));
    };

    const getWrittenJson = () => {
      const calls = (socket.write as any).mock.calls;
      return calls
        .map((call: any[]) => {
          const buffer = call[0] as Buffer;
          // Extract payload from simple websocket frame (assuming payload < 126 bytes for our test responses)
          const length = buffer[1] & 0x7f;
          let payloadOffset = 2;
          if (length === 126) payloadOffset = 4;
          if (length === 127) payloadOffset = 10;
          return JSON.parse(buffer.subarray(payloadOffset).toString("utf8"));
        })
        .filter((msg: any) => msg);
    };

    return { socket, sendClientMessage, getWrittenJson };
  };

  it("sends snapshot_required when afterSequence is genuinely behind and missed non-replayable events", () => {
    const { sendClientMessage, getWrittenJson, socket } = setupClient();

    realtimeService.getLatestSequenceForScopes.mockReturnValue(100);
    realtimeService.getLatestSequence.mockReturnValue(100);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);
    realtimeService.replay.mockReturnValue([]);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 50,
    });

    const responses = getWrittenJson();
    expect(responses).toContainEqual({
      type: "snapshot_required",
      reason: "non_replayable_event_missed",
    });
  });

  it("does not send snapshot_required when afterSequence is equal to latest scope sequence", () => {
    const { sendClientMessage, getWrittenJson } = setupClient();

    realtimeService.getLatestSequenceForScopes.mockReturnValue(100);
    realtimeService.getLatestSequence.mockReturnValue(100);
    // Should not even be called, but setting up just in case
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 100,
    });

    const responses = getWrittenJson();
    expect(realtimeService.hasNonReplayableEventsSince).not.toHaveBeenCalled();
    const snapshotReqs = responses.filter((r) => r.type === "snapshot_required");
    expect(snapshotReqs).toHaveLength(0);
    expect(responses).toContainEqual({
      type: "subscribed",
      scopes: ["project:p1"],
      lastSequence: 100,
    });
  });

  it("does not send snapshot_required when afterSequence is behind latest but events were pushed live", () => {
    const { sendClientMessage, getWrittenJson, socket } = setupClient();

    // 1. Initial subscription setup to get client tracked
    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 10,
    });

    (socket.write as any).mockClear();

    // 2. Push a live event to the client (updating lastPushedSequence)
    const subscribeCb = realtimeService.subscribe.mock.calls[0][0];
    subscribeCb({
      sequence: 15,
      scope: "project:p1",
      type: "event",
    });

    // 3. Now client resyncs but afterSequence (15) is behind latest overall sequence (e.g. 20)
    // because maybe another scope pushed the latest overall sequence, but for project:p1 they are up to date.
    realtimeService.getLatestSequenceForScopes.mockReturnValue(20);
    realtimeService.getLatestSequence.mockReturnValue(20);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);

    (socket.write as any).mockClear();

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 15, // This equals the last sequence pushed to them!
    });

    const responses = getWrittenJson();

    // We only care that on the SECOND set_subscriptions call, it wasn't called.
    // The first one might have called it if it fell through (though latestSequence was mocked to null initially maybe)
    const snapshotReqs = responses.filter((r) => r.type === "snapshot_required");
    expect(snapshotReqs).toHaveLength(0);
  });

  it("does not send snapshot_required when afterSequence = 0 (first connection)", () => {
    const { sendClientMessage, getWrittenJson } = setupClient();

    realtimeService.getLatestSequenceForScopes.mockReturnValue(100);
    realtimeService.getLatestSequence.mockReturnValue(100);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 0,
    });

    const responses = getWrittenJson();
    expect(realtimeService.hasNonReplayableEventsSince).not.toHaveBeenCalled();
    const snapshotReqs = responses.filter((r) => r.type === "snapshot_required");
    expect(snapshotReqs).toHaveLength(0);
    expect(responses).toContainEqual({
      type: "subscribed",
      scopes: ["project:p1"],
      lastSequence: 100,
    });
  });
});
