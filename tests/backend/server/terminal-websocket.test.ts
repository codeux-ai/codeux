import { describe, it, expect } from "vitest";
import {
  encodeFrame,
  parseClientFrames,
  acceptKey,
  trimOutputBuffer,
  MAX_CLIENT_MESSAGE_SIZE,
  MAX_REPLAY_BUFFER_SIZE,
} from "../../../src/server/terminal-websocket.js";

describe("terminal-websocket utilities", () => {
  describe("encodeFrame", () => {
    it("should encode short payloads (< 126)", () => {
      const payload = "hello";
      const frame = encodeFrame(payload);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(payload.length);
      expect(frame.subarray(2).toString()).toBe(payload);
    });

    it("should encode medium payloads (>= 126 and < 65536)", () => {
      const payload = "a".repeat(200);
      const frame = encodeFrame(payload);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
      expect(frame.subarray(4).toString()).toBe(payload);
    });

    it("should encode large payloads (>= 65536)", () => {
      const payload = "b".repeat(70000);
      const frame = encodeFrame(payload);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(127);
      expect(frame.readBigUInt64BE(2)).toBe(BigInt(70000));
      expect(frame.subarray(10).toString()).toBe(payload);
    });
  });

  describe("parseClientFrames", () => {
    function createMaskedFrame(payload: string, opcode = 0x1): Buffer {
      const data = Buffer.from(payload);
      const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
      const maskedData = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) {
        maskedData[i] = data[i] ^ mask[i % 4];
      }

      let header: Buffer;
      if (data.length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
      } else if (data.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(data.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(data.length), 2);
      }

      return Buffer.concat([header, mask, maskedData]);
    }

    it("should parse a simple masked text frame", () => {
      const frame = createMaskedFrame("hello");
      const result = parseClientFrames(frame);
      expect(result.messages).toEqual(["hello"]);
      expect(result.nextBuffer.length).toBe(0);
      expect(result.closed).toBe(false);
    });

    it("should handle fragmented data (multiple calls)", () => {
      const frame = createMaskedFrame("world");
      const part1 = frame.subarray(0, 5);
      const part2 = frame.subarray(5);

      const result1 = parseClientFrames(part1);
      expect(result1.messages).toEqual([]);
      expect(result1.nextBuffer).toEqual(part1);

      const result2 = parseClientFrames(Buffer.concat([result1.nextBuffer, part2]));
      expect(result2.messages).toEqual(["world"]);
      expect(result2.nextBuffer.length).toBe(0);
    });

    it("should reject unmasked frames", () => {
      const frame = Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      const result = parseClientFrames(frame);
      expect(result.closed).toBe(true);
    });

    it("should reject oversized frames", () => {
      const largePayloadSize = MAX_CLIENT_MESSAGE_SIZE + 1;
      const header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127; // Masked + 64-bit length
      header.writeBigUInt64BE(BigInt(largePayloadSize), 2);
      
      const result = parseClientFrames(header);
      expect(result.closed).toBe(true);
    });

    it("should handle close frames", () => {
      const frame = Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00]); // Masked close frame with 0 length
      const result = parseClientFrames(frame);
      expect(result.closed).toBe(true);
    });

    it("should handle multiple frames in one buffer", () => {
      const frame1 = createMaskedFrame("one");
      const frame2 = createMaskedFrame("two");
      const result = parseClientFrames(Buffer.concat([frame1, frame2]));
      expect(result.messages).toEqual(["one", "two"]);
      expect(result.nextBuffer.length).toBe(0);
    });
  });

  describe("acceptKey", () => {
    it("should compute correct Sec-WebSocket-Accept header", () => {
      // Example from RFC 6455
      const key = "dGhlIHNhbXBsZSBub25jZQ==";
      const expected = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
      expect(acceptKey(key)).toBe(expected);
    });
  });

  describe("trimOutputBuffer", () => {
    it("should not trim if below limit", () => {
      const input = "abc";
      expect(trimOutputBuffer(input)).toBe(input);
    });

    it("should trim if above limit", () => {
      const limit = MAX_REPLAY_BUFFER_SIZE;
      const input = "a".repeat(limit + 10);
      const output = trimOutputBuffer(input);
      expect(output.length).toBe(limit);
      expect(output).toBe("a".repeat(limit));
    });
  });
});
