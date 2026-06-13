import { createHash } from "crypto";
import type { Socket } from "net";

export const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Maximum size of the replay buffer for terminal output history (50,000 characters).
 */
export const MAX_REPLAY_BUFFER_SIZE = 50000;

/**
 * Maximum allowed size for an incoming client websocket frame payload (128KB).
 * Terminal input is typically very small (keystrokes), so 128KB is a safe,
 * conservative upper bound to prevent memory exhaustion attacks.
 */
export const MAX_CLIENT_MESSAGE_SIZE = 128 * 1024;

/**
 * Encodes a string payload into a low-level WebSocket text frame.
 */
export function encodeFrame(payload: string): Buffer {
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

/**
 * Sends a JSON payload to a socket as an encoded WebSocket frame.
 */
export function sendJson(socket: Socket, payload: unknown): void {
  try {
    socket.write(encodeFrame(JSON.stringify(payload)));
  } catch {
    // Ignore socket write errors
  }
}

/**
 * Sends a WebSocket close frame and ends the socket.
 */
export function closeSocket(socket: Socket): void {
  try {
    socket.end(Buffer.from([0x88, 0x00]));
  } catch {
    socket.destroy();
  }
}

/**
 * Parses incoming raw TCP data into individual WebSocket frames.
 * Enforces MAX_CLIENT_MESSAGE_SIZE to prevent unbounded buffering.
 */
export function parseClientFrames(buffer: Buffer): {
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

    // RFC6455 requires client-to-server frames to be masked
    if (!masked) {
      closed = true;
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
      if (!Number.isFinite(bigLength) || bigLength < 0) {
        closed = true;
        break;
      }
      payloadLength = bigLength;
      headerLength = 10;
    }

    // Security: Enforce maximum message size
    if (payloadLength > MAX_CLIENT_MESSAGE_SIZE) {
      closed = true;
      break;
    }

    const totalLength = headerLength + 4 + payloadLength; // 4 bytes for mask key
    if (offset + totalLength > buffer.length) {
      break;
    }

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = buffer.subarray(offset + headerLength + 4, offset + totalLength);
    
    // Unmask the payload in-place
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) { // Close
      closed = true;
      offset += totalLength;
      break;
    }

    if (opcode === 0x9) { // Ping
      // Handle pong if needed, but for now we just skip
      offset += totalLength;
      continue;
    }

    if (opcode === 0x1) { // Text
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

/**
 * Computes the Sec-WebSocket-Accept header value for the handshake.
 */
export function acceptKey(clientKey: string): string {
  return createHash("sha1").update(`${clientKey}${WS_MAGIC}`).digest("base64");
}

/**
 * Trims the terminal output replay buffer to MAX_REPLAY_BUFFER_SIZE.
 */
export function trimOutputBuffer(output: string): string {
  if (output.length > MAX_REPLAY_BUFFER_SIZE) {
    return output.substring(output.length - MAX_REPLAY_BUFFER_SIZE);
  }
  return output;
}
