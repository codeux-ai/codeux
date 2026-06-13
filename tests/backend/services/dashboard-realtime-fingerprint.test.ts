import { describe, expect, it } from "vitest";
import { calculateRealtimeFingerprint } from "../../../src/services/dashboard-realtime-fingerprint.js";

describe("calculateRealtimeFingerprint", () => {
  it("ignores top-level updatedAt and timestamp for fingerprinting", () => {
    const payload1 = { id: 1, name: "test", updatedAt: "2026-03-30T09:00:00.000Z" };
    const payload2 = { id: 1, name: "test", updatedAt: "2026-03-30" };
    const payload3 = { id: 1, name: "test", timestamp: "2026-03-30T09:00:00.000Z" };

    const res1 = calculateRealtimeFingerprint(payload1);
    const res2 = calculateRealtimeFingerprint(payload2);
    const res3 = calculateRealtimeFingerprint(payload3);

    expect(res1.fingerprint).toBe(res2.fingerprint);
    expect(res1.fingerprint).toBe(res3.fingerprint);
    expect(res1.sizeBytes).not.toBe(res2.sizeBytes); // ISO strings might be same length, but content is different
  });

  it("ignores nested updatedAt and timestamp", () => {
    const payload1 = {
      id: 1,
      nested: { value: "a", updatedAt: "2026-03-30T09:00:00.000Z" },
    };
    const payload2 = {
      id: 1,
      nested: { value: "a", updatedAt: "2026-03-31T10:00:00.000Z" },
    };

    const res1 = calculateRealtimeFingerprint(payload1);
    const res2 = calculateRealtimeFingerprint(payload2);

    expect(res1.fingerprint).toBe(res2.fingerprint);
  });

  it("detects changes in other fields", () => {
    const payload1 = { id: 1, name: "test", updatedAt: "2026-03-30T09:00:00.000Z" };
    const payload2 = { id: 1, name: "changed", updatedAt: "2026-03-30T09:00:00.000Z" };

    const res1 = calculateRealtimeFingerprint(payload1);
    const res2 = calculateRealtimeFingerprint(payload2);

    expect(res1.fingerprint).not.toBe(res2.fingerprint);
  });

  it("calculates size in bytes accurately for the full payload", () => {
    const payload = { a: "foo", updatedAt: "2026-03-30T09:00:00.000Z" };
    const res = calculateRealtimeFingerprint(payload);

    // {"a":"foo","updatedAt":"2026-03-30T09:00:00.000Z"}
    // 1+5+1+5+1+11+1+24+1+1 = 51 bytes (if no spaces)
    const expectedJson = JSON.stringify(payload);
    const expectedSize = Buffer.byteLength(expectedJson, "utf8");

    expect(res.sizeBytes).toBe(expectedSize);
    expect(res.sizeBytes).toBeGreaterThan(Buffer.byteLength(res.fingerprint, "utf8"));
  });

  it("handles null and undefined payloads", () => {
    expect(calculateRealtimeFingerprint(null)).toEqual({ fingerprint: "", sizeBytes: 0 });
    expect(calculateRealtimeFingerprint(undefined)).toEqual({ fingerprint: "", sizeBytes: 0 });
  });

  it("handles empty objects", () => {
    const res = calculateRealtimeFingerprint({});
    expect(res.fingerprint).toBe("{}");
    expect(res.sizeBytes).toBe(2);
  });
});
