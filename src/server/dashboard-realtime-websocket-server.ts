import { createHash } from "crypto";
import type { IncomingMessage, Server as HttpServer } from "http";
import type { Socket } from "net";
import type {
  DashboardRealtimeClientMessage,
  DashboardRealtimeEvent,
  DashboardRealtimeServerMessage,
} from "../contracts/app-types.js";
import { parseDashboardRealtimeScope } from "../repositories/dashboard-realtime-event-repository.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import type { Logger } from "../shared/logging/logger.js";

interface RealtimeClientState {
  socket: Socket;
  subscriptions: Set<string>;
  lastPushedSequence: number | null;
  recoveryAttempts: number[];
}

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

function sendJson(socket: Socket, payload: DashboardRealtimeServerMessage): void {
  if (socket.destroyed === true || socket.writable === false) {
    return;
  }
  try {
    socket.write(encodeFrame(JSON.stringify(payload)));
  } catch {
    // Ignore synchronous write errors on closed/broken sockets
  }
}

function closeSocket(socket: Socket): void {
  try {
    socket.end(Buffer.from([0x88, 0x00]));
  } catch {
    socket.destroy();
  }
}

function parseClientFrames(buffer: Buffer): {
  messages: string[];
  nextBuffer: Buffer;
  closed: boolean;
} {
  const messages: string[] = [];
  let offset = 0;
  let closed = false;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (!masked) {
      break;
    }

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const bigLength = Number(buffer.readBigUInt64BE(offset + 2));
      if (!Number.isFinite(bigLength)) {
        closed = true;
        break;
      }
      payloadLength = bigLength;
      headerLength = 10;
    }

    const totalLength = headerLength + 4 + payloadLength;
    if (offset + totalLength > buffer.length) {
      break;
    }

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = buffer.subarray(offset + headerLength + 4, offset + totalLength);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      closed = true;
      offset += totalLength;
      break;
    }

    if (opcode === 0x9) {
      offset += totalLength;
      continue;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }

    offset += totalLength;
  }

  return {
    messages,
    nextBuffer: buffer.subarray(offset),
    closed,
  };
}

function acceptKey(clientKey: string): string {
  return createHash("sha1").update(`${clientKey}${WS_MAGIC}`).digest("base64");
}

function isRealtimeUpgradeRequest(req: IncomingMessage, pathName: string): boolean {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname !== pathName) {
    return false;
  }

  const upgradeHeader = String(req.headers.upgrade || "").toLowerCase();
  const connectionHeader = String(req.headers.connection || "").toLowerCase();
  return upgradeHeader === "websocket" && connectionHeader.includes("upgrade");
}

export function bootDashboardRealtimeWebSocketServer(args: {
  server: HttpServer;
  pathName: string;
  realtimeService: DashboardRealtimeService;
  logger: Logger;
  shouldHandleRequest?: (req: IncomingMessage) => boolean;
}): void {
  const clients = new Map<Socket, RealtimeClientState>();

  const unsubscribe = args.realtimeService.subscribe((event) => {
    for (const client of clients.values()) {
      if (!client.subscriptions.has(event.scope)) {
        continue;
      }
      client.lastPushedSequence = event.sequence;
      sendJson(client.socket, {
        type: "event",
        event,
      });
    }
  });

  const upgradeHandler = (req: IncomingMessage, socket: Socket): void => {
    if (args.shouldHandleRequest && !args.shouldHandleRequest(req)) {
      return;
    }
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== args.pathName) {
      return;
    }
    if (!isRealtimeUpgradeRequest(req, args.pathName)) {
      socket.destroy();
      return;
    }

    const wsKey = String(req.headers["sec-websocket-key"] || "").trim();
    if (!wsKey) {
      socket.destroy();
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(wsKey)}`,
        "",
        "",
      ].join("\r\n"),
    );

    const client: RealtimeClientState = {
      socket,
      subscriptions: new Set<string>(),
      lastPushedSequence: null,
      recoveryAttempts: [],
    };
    clients.set(socket, client);
    sendJson(socket, { type: "ready" });

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = parseClientFrames(buffered);
      buffered = parsed.nextBuffer;

      if (parsed.closed) {
        closeSocket(socket);
        return;
      }

      for (const messageText of parsed.messages) {
        try {
          const message = JSON.parse(messageText) as DashboardRealtimeClientMessage;
          if (message.type !== "set_subscriptions") {
            continue;
          }

          const scopes = [...new Set((message.scopes || []).map((scope) => String(scope || "").trim()).filter(Boolean))];
          const validScopes = scopes.filter((scope) => parseDashboardRealtimeScope(scope) !== null);
          client.subscriptions = new Set(validScopes);

          const afterSequence = Math.max(0, Number(message.lastSequence ?? 0) || 0);
          if (afterSequence > 0 && validScopes.length > 0) {
            const latestSequence = args.realtimeService.getLatestSequenceForScopes(validScopes);

            const isUpToDateWithLatest = latestSequence !== null && afterSequence >= latestSequence;
            const receivedViaPush = client.lastPushedSequence !== null && afterSequence >= client.lastPushedSequence;
            const isGenuinelyBehind = !isUpToDateWithLatest && !receivedViaPush;

            if (isGenuinelyBehind) {
              const missedNonReplayableSnapshot = args.realtimeService.hasNonReplayableEventsSince(validScopes, afterSequence);
              const replayEvents = args.realtimeService.replay(validScopes, afterSequence, 200);
              const replayLastSequence = replayEvents[replayEvents.length - 1]?.sequence ?? afterSequence;

              if (missedNonReplayableSnapshot || (latestSequence !== null && replayLastSequence < latestSequence)) {
                const reason = missedNonReplayableSnapshot ? "non_replayable_event_missed" : "replay_window_exceeded";
                args.logger.warn("websocket_recovery_snapshot_required", {
                  reason,
                  afterSequence,
                  latestSequence
                });

                const now = Date.now();
                client.recoveryAttempts.push(now);
                client.recoveryAttempts = client.recoveryAttempts.filter(t => now - t <= 60000);
                if (client.recoveryAttempts.length > 3) {
                  args.logger.warn("repeated_unhealthy_recovery_patterns", {
                    clientId: socket.remoteAddress || "unknown",
                    count: client.recoveryAttempts.length
                  });
                  client.recoveryAttempts = [];
                }

                sendJson(socket, {
                  type: "snapshot_required",
                  reason,
                });
              } else {
                for (const replayEvent of replayEvents) {
                  sendJson(socket, {
                    type: "event",
                    event: replayEvent,
                  });
                }
              }
            }
          }

          sendJson(socket, {
            type: "subscribed",
            scopes: validScopes,
            lastSequence: args.realtimeService.getLatestSequence(),
          });
        } catch (error) {
          args.logger.warn("Invalid dashboard realtime websocket message", { error });
          const reason = "invalid_client_message";
          args.logger.warn("websocket_recovery_snapshot_required", { reason });

          const now = Date.now();
          client.recoveryAttempts.push(now);
          client.recoveryAttempts = client.recoveryAttempts.filter(t => now - t <= 60000);
          if (client.recoveryAttempts.length > 3) {
            args.logger.warn("repeated_unhealthy_recovery_patterns", {
              clientId: socket.remoteAddress || "unknown",
              count: client.recoveryAttempts.length
            });
            client.recoveryAttempts = [];
          }

          sendJson(socket, {
            type: "snapshot_required",
            reason,
          });
        }
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
    socket.on("end", () => {
      clients.delete(socket);
    });
    socket.on("error", (error) => {
      clients.delete(socket);
      args.logger.warn("Dashboard realtime websocket client error", { error });
    });
  };

  args.server.on("upgrade", upgradeHandler);
  args.server.on("close", () => {
    unsubscribe();
    args.server.off("upgrade", upgradeHandler);
    for (const client of clients.values()) {
      client.socket.destroy();
    }
    clients.clear();
  });
}
