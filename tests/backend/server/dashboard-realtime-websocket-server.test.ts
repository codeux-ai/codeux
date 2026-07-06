import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { bootDashboardRealtimeWebSocketServer } from "../../../src/server/dashboard-realtime-websocket-server.js";
import type { DashboardRealtimeEvent } from "../../../src/contracts/app-types.js";
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

function decodeFramePayload(buffer: Buffer): unknown {
  const length = buffer[1] & 0x7f;
  let payloadOffset = 2;
  if (length === 126) {
    payloadOffset = 4;
  }
  if (length === 127) {
    payloadOffset = 10;
  }
  return JSON.parse(buffer.subarray(payloadOffset).toString("utf8"));
}

function createRealtimeEvent(overrides: Partial<DashboardRealtimeEvent> = {}): DashboardRealtimeEvent {
  return {
    sequence: 11,
    emittedAt: "2026-03-30T09:00:00.000Z",
    scopeType: "project",
    scopeId: "p1:live",
    scope: "project:p1:live",
    eventType: "project.live.updated",
    entityType: "project_live",
    entityId: "p1",
    projectId: "p1",
    sprintId: null,
    threadId: null,
    taskId: null,
    dispatchId: null,
    sprintRunId: null,
    taskRunId: null,
    connectionId: null,
    correlationId: "corr-1",
    payload: {},
    ...overrides,
  };
}

describe("DashboardRealtimeWebSocketServer", () => {
  let server: HttpServer;
  let realtimeService: vi.Mocked<DashboardRealtimeService>;
  let logger: vi.Mocked<Logger>;

  beforeEach(() => {
    server = new EventEmitter() as any;
    realtimeService = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      setScopeInterestResolver: vi.fn(),
      getLatestSequenceForScopes: vi.fn(),
      getLatestSequence: vi.fn(),
      hasNonReplayableEventsSince: vi.fn(),
      replay: vi.fn(),
    } as unknown as vi.Mocked<DashboardRealtimeService>;

    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as vi.Mocked<Logger>;

    bootDashboardRealtimeWebSocketServer({
      server,
      pathName: "/api/realtime",
      realtimeService,
      logger,
    });
  });

  const setupClient = (headers: Record<string, string> = {}) => {
    const socket = new EventEmitter() as Socket;
    socket.write = vi.fn();
    socket.end = vi.fn();
    socket.destroy = vi.fn();

    const req = {
      url: "/api/realtime",
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "testkey",
        ...headers,
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
          return decodeFramePayload(buffer);
        })
        .filter((msg: any) => msg);
    };

    return { socket, sendClientMessage, getWrittenJson };
  };

  const setupRawClient = () => {
    const socket = new EventEmitter() as Socket;
    socket.write = vi.fn();
    socket.end = vi.fn();
    socket.destroy = vi.fn();

    const req = {
      url: "/api/realtime",
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "testkey",
      },
    } as unknown as IncomingMessage;

    server.emit("upgrade", req, socket);
    (socket.write as any).mockClear();

    return socket;
  };


  describe("Websocket Security", () => {
    it("accepts loopback/no-origin realtime upgrade", () => {
      const socket = new EventEmitter() as any;
      socket.write = vi.fn();
      socket.end = vi.fn();
      socket.destroy = vi.fn();

      const req = {
        url: "/api/realtime",
        method: "GET",
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "testkey",
        },
      } as unknown as IncomingMessage;

      server.emit("upgrade", req, socket);

      expect(socket.destroy).not.toHaveBeenCalled();
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("101 Switching Protocols"));
    });

    it("rejects hostile Sec-Fetch-Site: cross-site upgrade", () => {
      const socket = new EventEmitter();
      socket.write = vi.fn();
      socket.end = vi.fn();
      socket.destroy = vi.fn();

      const req = {
        url: "/api/realtime",
        method: "GET",
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "testkey",
          "sec-fetch-site": "cross-site",
          host: "localhost:4000",
        },
      };

      server.emit("upgrade", req, socket);

      expect(logger.warn).toHaveBeenCalledWith("websocket_upgrade_rejected_hostile_origin", expect.objectContaining({ logPurpose: "security" }));
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("rejects hostile Origin upgrade", () => {
      const socket = new EventEmitter();
      socket.write = vi.fn();
      socket.end = vi.fn();
      socket.destroy = vi.fn();

      const req = {
        url: "/api/realtime",
        method: "GET",
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "testkey",
          origin: "https://evil.com",
          host: "localhost:4000",
        },
      };

      server.emit("upgrade", req, socket);

      expect(logger.warn).toHaveBeenCalledWith("websocket_upgrade_rejected_hostile_origin", expect.objectContaining({ logPurpose: "security" }));
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe("Websocket Frame Limits", () => {

    it("rejects unmasked frames by closing the socket", () => {
      const socket = setupRawClient();

      const payload = Buffer.from(JSON.stringify({ type: "ping" }));
      const header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = payload.length; // No mask bit set

      socket.emit("data", Buffer.concat([header, payload]));

      expect(socket.end).toHaveBeenCalledWith(Buffer.from([0x88, 0x00]));
    });

    it("rejects oversized frames by closing the socket", () => {
      const socket = setupRawClient();

      // Simulate a payload that says it's 600KB
      const length = 600 * 1024;
      const header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127 | 0x80;
      header.writeBigUInt64BE(BigInt(length), 2);

      socket.emit("data", header);

      expect(socket.end).toHaveBeenCalledWith(Buffer.from([0x88, 0x00]));
    });

    it("rejects accumulated buffer exceeding 1MB", () => {
      const socket = setupRawClient();

      // Send chunks that sum up to > 1MB
      const chunk1 = Buffer.alloc(600 * 1024, "a");
      const chunk2 = Buffer.alloc(500 * 1024, "a");

      socket.emit("data", chunk1);
      socket.emit("data", chunk2);

      expect(socket.end).toHaveBeenCalledWith(Buffer.from([0x88, 0x00]));
    });

    it("allows partial frame buffering within the limit", () => {
      const { socket, sendClientMessage, getWrittenJson } = setupClient();

      realtimeService.getLatestSequenceForScopes.mockReturnValue(100);
      realtimeService.getLatestSequence.mockReturnValue(100);
      realtimeService.hasNonReplayableEventsSince.mockReturnValue(true);

      // We will send the client message normally, it should just work.
      sendClientMessage({
        type: "set_subscriptions",
        scopes: ["project:p2"],
        lastSequence: 0,
      });

      const responses = getWrittenJson();
      expect(responses).toContainEqual({
        type: "subscribed",
        scopes: ["project:p2"],
        lastSequence: 100,
      });
      expect(socket.end).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });
  });

  it("sends snapshot_required when afterSequence is genuinely behind and missed non-replayable events", () => {
    const { sendClientMessage, getWrittenJson } = setupClient({ "x-correlation-id": "ws-corr-1" });

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
    expect(logger.warn).toHaveBeenCalledWith(
      "websocket_recovery_snapshot_required",
      expect.objectContaining({
        logPurpose: "realtime",
        reason: "non_replayable_event_missed",
        afterSequence: 50,
        latestSequence: 100,
        scopes: ["project:p1"],
        correlationId: "ws-corr-1",
      }),
    );
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

  it("forces snapshot_required when the client is ahead of the server (server restarted)", () => {
    const { sendClientMessage, getWrittenJson } = setupClient();

    // After a restart, the server's in-memory watermarks are gone and its sequence has
    // reseeded to the (lower) max persisted replayable sequence. A client that previously
    // saw sequence 200 reconnects; the server only knows up to 100.
    realtimeService.getLatestSequenceForScopes.mockReturnValue(100);
    realtimeService.getLatestSequence.mockReturnValue(100);
    realtimeService.hasNonReplayableEventsSince.mockReturnValue(false);
    realtimeService.replay.mockReturnValue([]);

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 200,
    });

    const responses = getWrittenJson();
    expect(responses).toContainEqual({
      type: "snapshot_required",
      reason: "non_replayable_event_missed",
    });
  });

  it("logs invalid client messages with correlation metadata but without raw websocket payloads", () => {
    const { socket, getWrittenJson } = setupClient({ "x-request-id": "ws-request-corr" });
    const secretPayload = "invalid-json-with-token-secret-" + "x".repeat(4096);
    const payload = Buffer.from(secretPayload);
    const header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 126 | 0x80;
    header.writeUInt16BE(payload.length, 2);
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 0;

    socket.emit("data", Buffer.concat([header, payload]));

    expect(getWrittenJson()).toContainEqual({
      type: "snapshot_required",
      reason: "invalid_client_message",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Invalid dashboard realtime websocket message",
      expect.objectContaining({
        logPurpose: "realtime",
        correlationId: "ws-request-corr",
        error: expect.any(SyntaxError),
      }),
    );
    const serializedLogs = JSON.stringify(logger.warn.mock.calls);
    expect(serializedLogs).not.toContain(secretPayload);
    expect(serializedLogs).not.toContain("invalid-json-with-token-secret");
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

  it("logs and isolates websocket broadcast failures with event context", () => {
    const { sendClientMessage, socket } = setupClient();

    realtimeService.getLatestSequence.mockReturnValue(10);
    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1"],
      lastSequence: 0,
    });

    (socket.write as any).mockImplementation(() => {
      throw new Error("broken pipe");
    });

    const subscribeCallback = realtimeService.subscribe.mock.calls[0][0];
    subscribeCallback({
      sequence: 11,
      emittedAt: "2026-03-30T09:00:00.000Z",
      scopeType: "project",
      scopeId: "p1",
      scope: "project:p1",
      eventType: "project.execution.updated",
      entityType: "project",
      entityId: "p1",
      projectId: "p1",
      sprintId: null,
      threadId: null,
      taskId: null,
      dispatchId: null,
      sprintRunId: null,
      taskRunId: null,
      connectionId: null,
      correlationId: "corr-1",
      payload: {},
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "dashboard_realtime_websocket_broadcast_failed",
      expect.objectContaining({
        logPurpose: "realtime",
        eventType: "project.execution.updated",
        sequence: 11,
        scope: "project:p1",
        projectId: "p1",
        correlationId: "corr-1",
        error: expect.any(Error),
      }),
    );
    const broadcastLog = logger.warn.mock.calls.find((call) => call[0] === "dashboard_realtime_websocket_broadcast_failed");
    expect(broadcastLog?.[1]).not.toHaveProperty("payload");
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("serializes each realtime event once and sends it only to subscribed clients", () => {
    const firstLiveClient = setupClient();
    const secondLiveClient = setupClient();
    const unrelatedClient = setupClient();

    firstLiveClient.sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:live"],
      lastSequence: 0,
    });
    secondLiveClient.sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:live"],
      lastSequence: 0,
    });
    unrelatedClient.sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:git"],
      lastSequence: 0,
    });

    (firstLiveClient.socket.write as any).mockClear();
    (secondLiveClient.socket.write as any).mockClear();
    (unrelatedClient.socket.write as any).mockClear();

    const serializePayload = vi.fn(() => ({ blob: "x".repeat(130_000) }));
    const subscribeCallback = realtimeService.subscribe.mock.calls[0][0];
    subscribeCallback(createRealtimeEvent({
      sequence: 12,
      payload: {
        toJSON: serializePayload,
      },
    }));

    expect(serializePayload).toHaveBeenCalledTimes(1);
    expect(firstLiveClient.socket.write).toHaveBeenCalledTimes(1);
    expect(secondLiveClient.socket.write).toHaveBeenCalledTimes(1);
    expect(unrelatedClient.socket.write).not.toHaveBeenCalled();

    const firstFrame = (firstLiveClient.socket.write as any).mock.calls[0][0] as Buffer;
    const secondFrame = (secondLiveClient.socket.write as any).mock.calls[0][0] as Buffer;
    expect(secondFrame).toBe(firstFrame);
    expect(decodeFramePayload(firstFrame)).toMatchObject({
      type: "event",
      event: {
        sequence: 12,
        scope: "project:p1:live",
        payload: {
          blob: expect.any(String),
        },
      },
    });
  });

  it("does not serialize realtime event payloads when no clients are subscribed to the scope", () => {
    const unrelatedClient = setupClient();

    unrelatedClient.sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:git"],
      lastSequence: 0,
    });
    (unrelatedClient.socket.write as any).mockClear();

    const serializePayload = vi.fn(() => {
      throw new Error("payload should not be serialized");
    });
    const subscribeCallback = realtimeService.subscribe.mock.calls[0][0];
    expect(() => {
      subscribeCallback(createRealtimeEvent({
        sequence: 12,
        payload: {
          toJSON: serializePayload,
        },
      }));
    }).not.toThrow();

    expect(serializePayload).not.toHaveBeenCalled();
    expect(unrelatedClient.socket.write).not.toHaveBeenCalled();
  });

  it("registers websocket subscription interest with the realtime service", () => {
    const { sendClientMessage } = setupClient();

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:live"],
      lastSequence: 0,
    });

    const resolver = realtimeService.setScopeInterestResolver.mock.calls[0][0]!;
    expect(resolver("project:p1:live")).toBe(true);
    expect(resolver("project:p1:git")).toBe(false);
  });

  it("disconnects slow websocket clients before buffering unbounded realtime frames", () => {
    const { sendClientMessage, socket } = setupClient();

    Object.defineProperty(socket, "writable", { value: true, configurable: true });
    Object.defineProperty(socket, "destroyed", { value: false, configurable: true });
    Object.defineProperty(socket, "writableLength", { value: 20 * 1024 * 1024, configurable: true });

    sendClientMessage({
      type: "set_subscriptions",
      scopes: ["project:p1:live"],
      lastSequence: 0,
    });

    const subscribeCallback = realtimeService.subscribe.mock.calls[0][0];
    subscribeCallback({
      sequence: 12,
      emittedAt: "2026-03-30T09:00:00.000Z",
      scopeType: "project",
      scopeId: "p1:live",
      scope: "project:p1:live",
      eventType: "project.live.updated",
      entityType: "project_live",
      entityId: "p1",
      projectId: "p1",
      sprintId: null,
      threadId: null,
      taskId: null,
      dispatchId: null,
      sprintRunId: null,
      taskRunId: null,
      connectionId: null,
      correlationId: "corr-1",
      payload: { selectedSprintId: "s1" },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "dashboard_realtime_websocket_backpressure_disconnect",
      expect.objectContaining({
        logPurpose: "realtime",
        eventType: "project.live.updated",
        scope: "project:p1:live",
        projectId: "p1",
      }),
    );
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe("DashboardRealtimeWebSocketServer observability", () => {
  it("emits repeated_unhealthy_recovery_patterns when clients constantly require snapshots due to invalid messages", () => {
    const serverMock = new EventEmitter();
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const realtimeServiceMock = {
      subscribe: vi.fn().mockReturnValue(() => {}),
      setScopeInterestResolver: vi.fn(),
      getLatestSequenceForScopes: vi.fn(),
      getLatestSequence: vi.fn(),
    };

    bootDashboardRealtimeWebSocketServer({
      server: serverMock as any,
      pathName: "/api/realtime",
      realtimeService: realtimeServiceMock as any,
      logger: loggerMock as any,
    });

    const socketMock = new EventEmitter();
    (socketMock as any).write = vi.fn();
    (socketMock as any).remoteAddress = "127.0.0.1";
    (socketMock as any).destroy = vi.fn();

    const reqMock = {
      url: "/api/realtime",
      headers: {
        upgrade: "websocket",
        connection: "upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    };

    serverMock.emit("upgrade", reqMock, socketMock);

    // Simulate invalid frames which force snapshot_required and count as recovery attempts
    for (let i = 0; i < 4; i++) {
      const invalidPayload = Buffer.from("invalid-json");
      const length = invalidPayload.length;
      const header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = length | 0x80;
      header[2] = 0;
      header[3] = 0;
      header[4] = 0;
      header[5] = 0;
      const combined = Buffer.concat([header, invalidPayload]);
      socketMock.emit("data", combined);
    }

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "repeated_unhealthy_recovery_patterns",
      expect.objectContaining({
        logPurpose: "realtime",
        clientId: "127.0.0.1",
        count: 4,
      })
    );
  });
});
